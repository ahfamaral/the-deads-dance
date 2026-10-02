import type { EmbeddingsInterface } from "@langchain/core/embeddings";
import type { Pool } from "pg";
import { chunkArticle, CHUNK_OVERLAP, CHUNK_SIZE, DROPPED_SECTIONS, type Chunk } from "./chunking";
import { toVectorLiteral } from "./db";
import { assertDimensions, EMBEDDING_MODEL } from "./embeddings";
import { sameLanguages, type PersonaLanguage } from "./languages";
import { findPersona, type PersonaOrigin, type PersonaRow } from "./personas";
import { CURATED_PROFILE_STAMP, profileStamp, sameProfile, type CharacterProfile, type GenerateProfile } from "./profile";
import type { Article } from "./wikipedia";

/**
 * Identifies how a persona's stored vectors were made. A persona is re-embedded when
 * this differs — a different model or chunking would otherwise return plausible but
 * wrong neighbours, with no error. The Wikipedia revision is deliberately left out:
 * article edits come in only on --refresh.
 */
export const BUILD_STAMP = JSON.stringify({
  embeddingModel: EMBEDDING_MODEL,
  chunkSize: CHUNK_SIZE,
  chunkOverlap: CHUNK_OVERLAP,
  droppedSections: DROPPED_SECTIONS,
});

export const STALE_INGEST_MINUTES = 10;

export type PersonaEntry = {
  slug: string;
  wikipediaTitle: string;
  origin: PersonaOrigin;
  displayName?: string;
  description?: string;
  lifespan?: string;
  /** Spec §17.1: a developer-reviewed profile from personas.json; wins over generation. */
  profile?: CharacterProfile;
  /** Spec §18.4: a developer-reviewed list from personas.json; wins over Wikidata. */
  languages?: PersonaLanguage[];
};

export type IngestStep = "fetching" | "chunking" | "embedding" | "profiling" | "saving";
/** Spec §6/§17.5: each stage reports its start and its finish; embedding and profiling overlap. */
export type IngestProgress = { step: IngestStep; status: "started" | "finished"; chunks?: number };
export type IngestDeps = {
  pool: Pool;
  embeddings: EmbeddingsInterface;
  fetchArticle: (title: string) => Promise<Article>;
  /** Spec §17.1. Real version: profileGenerator() (the helper model, 90 s timeout). */
  generateProfile: GenerateProfile;
  /** Spec §18.4. Real version: fetchPersonLanguages (Wikidata P103/P1412). */
  fetchLanguages: (qid: string) => Promise<PersonaLanguage[]>;
};
export type IngestOptions = {
  refresh?: boolean;
  /** Already fetched (the add-persona route validates before ingesting). */
  article?: Article;
  onProgress?: (progress: IngestProgress) => void;
};
export type IngestResult = { outcome: "skipped" | "updated" | "ingested"; persona: PersonaRow; chunkCount: number };

export class IngestError extends Error {
  constructor(
    readonly code: "in_progress" | "empty_article",
    message: string,
  ) {
    super(message);
    this.name = "IngestError";
  }
}

export function isStaleIngest(row: PersonaRow, now = new Date()): boolean {
  return row.status === "ingesting" && now.getTime() - row.updatedAt.getTime() > STALE_INGEST_MINUTES * 60_000;
}

type ProfileState = { profile: CharacterProfile | null; stamp: string | null };

/**
 * Spec §17.1: a pinned profile wins; a generated one at the current stamp is kept;
 * otherwise generate. Never throws — a failure keeps what is stored, so the next run retries.
 */
async function resolveProfile(
  entry: PersonaEntry,
  existing: PersonaRow | null,
  articleText: string | null,
  generate: GenerateProfile,
  progress: (p: IngestProgress) => void,
): Promise<ProfileState> {
  if (entry.profile) return { profile: entry.profile, stamp: CURATED_PROFILE_STAMP };
  const kept = { profile: existing?.profile ?? null, stamp: existing?.profileStamp ?? null };
  const current = profileStamp();
  if ((existing?.profile && existing.profileStamp === current) || !articleText) return kept;
  progress({ step: "profiling", status: "started" });
  try {
    return { profile: await generate(articleText), stamp: current };
  } catch (err) {
    console.error(
      `Character profile for ${entry.slug} failed; keeping the stored one. ${err instanceof Error ? err.message : String(err)}`,
    );
    return kept;
  } finally {
    progress({ step: "profiling", status: "finished" });
  }
}

/**
 * Spec §18.4: a pinned list wins; a stored list is kept; otherwise look it up by QID.
 * Never throws — a failure stores null, so the next run retries.
 */
async function resolveLanguages(
  entry: PersonaEntry,
  existing: PersonaRow | null,
  qid: string | null,
  fetchLanguages: IngestDeps["fetchLanguages"],
): Promise<PersonaLanguage[] | null> {
  if (entry.languages) return entry.languages;
  if (existing?.storedLanguages) return existing.storedLanguages;
  if (!qid) return null;
  try {
    return await fetchLanguages(qid);
  } catch (err) {
    console.error(`Languages for ${entry.slug} failed; retrying on the next ingest. ${err instanceof Error ? err.message : String(err)}`);
    return null;
  }
}

const languagesJson = (languages: PersonaLanguage[] | null) => (languages === null ? null : JSON.stringify(languages));

const profileJson = (profile: CharacterProfile | null) => (profile === null ? null : JSON.stringify(profile));

/**
 * Inserts the row as 'ingesting', or takes over a failed or stale one. The unique slug
 * makes this the lock against two concurrent ingests of the same persona.
 */
async function claim(pool: Pool, entry: PersonaEntry): Promise<number> {
  const { rows } = await pool.query<{ id: number }>(
    `INSERT INTO personas (slug, display_name, wikipedia_title, origin, status, updated_at)
     VALUES ($1, $2, $3, $4, 'ingesting', now())
     ON CONFLICT (slug) DO UPDATE SET status = 'ingesting', updated_at = now()
     WHERE personas.status = 'failed'
        OR (personas.status = 'ingesting' AND personas.updated_at < now() - make_interval(mins => $5))
     RETURNING id`,
    [entry.slug, entry.displayName ?? entry.wikipediaTitle, entry.wikipediaTitle, entry.origin, STALE_INGEST_MINUTES],
  );
  if (!rows[0]) throw new IngestError("in_progress", `${entry.displayName ?? entry.wikipediaTitle} is already being added.`);
  return rows[0].id;
}

/** Swaps the persona's text and chunks in one transaction, so readers see old or new, never half. */
async function save(
  pool: Pool,
  id: number,
  entry: PersonaEntry,
  article: Article,
  chunks: Chunk[],
  vectors: number[][],
  profile: ProfileState,
  languages: PersonaLanguage[] | null,
) {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await client.query(
      `UPDATE personas SET display_name = $2, description = $3, lifespan = $4, wikipedia_title = $5,
         wikipedia_revid = $6, wikidata_qid = $7, source_text = $8, origin = $9,
         status = 'ready', build_stamp = $10, profile = $11::jsonb, profile_stamp = $12, languages = $13::jsonb,
         ingested_at = now(), updated_at = now()
       WHERE id = $1`,
      [
        id,
        entry.displayName ?? article.title,
        entry.description ?? "",
        entry.lifespan ?? "",
        entry.wikipediaTitle,
        article.revid,
        article.qid,
        article.text,
        entry.origin,
        BUILD_STAMP,
        profileJson(profile.profile),
        profile.stamp,
        languagesJson(languages),
      ],
    );
    await client.query("DELETE FROM chunks WHERE persona_id = $1", [id]);
    await client.query(
      `INSERT INTO chunks (persona_id, section_heading, ordinal, content, embedding)
       SELECT $1, h, o, c, e::vector FROM unnest($2::text[], $3::int[], $4::text[], $5::text[]) AS t(h, o, c, e)`,
      [
        id,
        chunks.map((c) => c.sectionHeading),
        chunks.map((c) => c.ordinal),
        chunks.map((c) => c.content),
        vectors.map(toVectorLiteral),
      ],
    );
    await client.query("COMMIT");
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    client.release();
  }
}

export async function ingestPersona(
  entry: PersonaEntry,
  deps: IngestDeps,
  options: IngestOptions = {},
): Promise<IngestResult> {
  const { pool } = deps;
  const progress = options.onProgress ?? (() => {});
  const existing = await findPersona(pool, entry.slug);

  if (existing?.status === "ready" && existing.buildStamp === BUILD_STAMP && !options.refresh && !options.article) {
    const { rows } = await pool.query<{ n: number }>("SELECT count(*)::int AS n FROM chunks WHERE persona_id = $1", [
      existing.id,
    ]);
    const chunkCount = rows[0].n;

    const displayName = entry.displayName ?? existing.displayName;
    const description = entry.description ?? "";
    const lifespan = entry.lifespan ?? "";
    const profile = await resolveProfile(entry, existing, existing.sourceText, deps.generateProfile, progress);
    const languages = await resolveLanguages(entry, existing, existing.wikidataQid, deps.fetchLanguages);
    const unchanged =
      displayName === existing.displayName &&
      description === existing.description &&
      lifespan === existing.lifespan &&
      entry.origin === existing.origin &&
      sameProfile(profile.profile, existing.profile) &&
      profile.stamp === existing.profileStamp &&
      sameLanguages(languages, existing.storedLanguages);

    if (unchanged) {
      return { outcome: "skipped", persona: existing, chunkCount };
    }

    await pool.query(
      `UPDATE personas SET display_name = $2, description = $3, lifespan = $4, origin = $5,
         profile = $6::jsonb, profile_stamp = $7, languages = $8::jsonb, updated_at = now()
       WHERE id = $1`,
      [existing.id, displayName, description, lifespan, entry.origin, profileJson(profile.profile), profile.stamp, languagesJson(languages)],
    );
    const persona = await findPersona(pool, entry.slug);
    if (!persona) throw new Error(`${entry.slug} vanished after update.`);
    return { outcome: "updated", persona, chunkCount };
  }

  // A ready persona stays visible, unchanged, until the new version is swapped in.
  const claimed = existing?.status !== "ready";
  const id = claimed ? await claim(pool, entry) : existing!.id;

  let chunkCount = 0;
  try {
    let article: Article;
    if (options.article) {
      article = options.article;
    } else if (!options.refresh && existing?.sourceText) {
      article = {
        title: existing.wikipediaTitle,
        revid: existing.wikipediaRevid ?? 0,
        qid: existing.wikidataQid,
        text: existing.sourceText,
      };
    } else {
      progress({ step: "fetching", status: "started" });
      article = await deps.fetchArticle(entry.wikipediaTitle);
      progress({ step: "fetching", status: "finished" });
    }

    progress({ step: "chunking", status: "started" });
    const chunks = await chunkArticle(article.text);
    if (chunks.length === 0) {
      throw new IngestError("empty_article", `"${article.title}" has no article text to embed.`);
    }
    progress({ step: "chunking", status: "finished" });

    const n = chunks.length;
    progress({ step: "embedding", status: "started", chunks: n });
    const embedding = deps.embeddings.embedDocuments(chunks.map((c) => c.content)).then((vectors) => {
      progress({ step: "embedding", status: "finished", chunks: n });
      return vectors;
    });
    // Spec §17.1: concurrent, so adding a persona takes no longer; resolveProfile never rejects.
    const [vectors, profile, languages] = await Promise.all([
      embedding,
      resolveProfile(entry, existing, article.text, deps.generateProfile, progress),
      resolveLanguages(entry, existing, article.qid, deps.fetchLanguages),
    ]);
    assertDimensions(vectors);

    progress({ step: "saving", status: "started" });
    await save(pool, id, entry, article, chunks, vectors, profile, languages);
    progress({ step: "saving", status: "finished" });
    chunkCount = chunks.length;
  } catch (err) {
    if (claimed) {
      await pool.query("UPDATE personas SET status = 'failed', updated_at = now() WHERE id = $1", [id]);
    }
    throw err;
  }

  const persona = await findPersona(pool, entry.slug);
  if (!persona) throw new Error(`${entry.slug} vanished after ingest.`);
  return { outcome: "ingested", persona, chunkCount };
}
