/**
 * Spec §34.6: one ingestion round. Fetches every new text first (free), then chunks and embeds
 * each item with its own cost ledger, optionally redrafts the profile and highlights, and swaps
 * the persona's memory in one transaction. The persona stays ready throughout.
 */
import type { EmbeddingsInterface } from "@langchain/core/embeddings";
import type { Pool } from "pg";
import { MAX_ARTICLE_CHARS } from "./add-persona";
import { chunkSource, type Chunk } from "./chunking";
import { CostLedger, type ModelCallRecord } from "./cost-ledger";
import { assertDimensions } from "./embeddings";
import { extractQuotes, paragraphsNaming } from "./extras";
import type { DraftHighlights } from "./highlights";
import { BUILD_STAMP, claim, insertChunks, type PersonaEntry } from "./ingest";
import { languageName, type PersonaLanguage } from "./languages";
import { planChanges, sourceKey, type PlannedChange, type SourcePlan } from "./plan-changes";
import { findPersona, type PersonaRow } from "./personas";
import { CURATED_PROFILE_STAMP, profileStamp, type CharacterProfile, type GenerateProfile } from "./profile";
import {
  addItem, finishRound, insertSource, listSources, RoundBusyError, setItemCost, startRound, updateItem,
  type SourceRef, type StoredSource,
} from "./rounds";
import { WikipediaError, type WikimediaClient } from "./wikimedia";

export { planChanges, type PlannedChange, type SourcePlan } from "./plan-changes";

/** Spec §34.6: new text per round, so a reingest can't silently grow a persona tenfold and fits the function limit. */
export const MAX_ROUND_CHARS = 600_000;

export type RoundErrorCode = "round_running" | "too_large" | "empty_article" | "persona_gone";

export class RoundError extends Error {
  constructor(
    readonly code: RoundErrorCode,
    message: string,
  ) {
    super(message);
    this.name = "RoundError";
  }
}

export type RoundTarget = { kind: "existing"; persona: PersonaRow } | { kind: "new"; entry: PersonaEntry; qid: string };

export type RoundDeps = {
  pool: Pool;
  client: WikimediaClient;
  embeddings: (ledger: CostLedger) => EmbeddingsInterface;
  generateProfile: (ledger: CostLedger) => GenerateProfile;
  draftHighlights: (ledger: CostLedger) => DraftHighlights;
  fetchLanguages: (qid: string) => Promise<PersonaLanguage[]>;
  /** Resolves and records the item's calls (the route supplies it; corpus can't import `@/`); returns its cost in micro-dollars. */
  onItemCalls: (itemId: number, calls: ModelCallRecord[]) => Promise<number>;
};

/** `spent` is the round's cost so far, in micro-dollars. */
export type RoundProgress = { label: string; status: "started" | "finished" | "skipped"; spent: number };
/** `passages` is how many the persona's memory holds after the round. */
export type RoundResult = { roundId: number; persona: PersonaRow; cost: number; passages: number };

/** An added or replaced source on its way in. */
type Incoming = {
  change: PlannedChange;
  itemId: number;
  estimated: number;
  label: string;
  revid: number | null;
  text: string;
  chunks: Chunk[];
  vectors: number[][];
};

const plural = (n: number) => `${n} passage${n === 1 ? "" : "s"}`;

function baseLabel(ref: SourceRef): string {
  switch (ref.kind) {
    case "article":
      return `${languageName(ref.language)} article`;
    case "quotes":
      return "Real quotes";
    case "writing":
      return `Own writing: ${ref.title}`;
    case "linked":
      return `Linked article: ${ref.title}`;
    case "mention":
      return `Mentions: ${ref.title}`;
  }
}

/** "Portuguese article, 212 passages (replaced English)", "Real quotes, 22", "Mentions: Fluminense Football Club". */
function itemLabel(change: PlannedChange, passages: number | null): string {
  const { ref, replaces } = change;
  let label = baseLabel(ref);
  if (passages !== null && ref.kind === "quotes") label += `, ${passages}`;
  else if (passages !== null && ref.kind !== "mention") label += `, ${plural(passages)}`;
  if (replaces) {
    const old = replaces.language === ref.language ? `"${replaces.title}"` : languageName(replaces.language);
    label += ` (replaced ${old})`;
  }
  return label;
}

const isMissing = (err: unknown) => err instanceof WikipediaError && (err.code === "not_found" || err.code === "disambiguation");

/** The text this source adds: the page, its quotes one per line, or the paragraphs naming the persona one per line. Null when the page is gone. */
async function fetchText(client: WikimediaClient, ref: SourceRef, names: string[]): Promise<{ text: string; revid: number | null } | null> {
  let page;
  try {
    page = await client.extract({ site: ref.site, language: ref.language }, ref.title);
  } catch (err) {
    if (ref.kind !== "article" && isMissing(err)) return null;
    if (ref.kind === "article" && isMissing(err)) throw new RoundError("empty_article", (err as Error).message);
    throw err;
  }
  const revid = page.revid || null;
  if (ref.kind === "quotes") return { text: extractQuotes(page.text, ref.language).join("\n"), revid };
  if (ref.kind === "mention") return { text: paragraphsNaming(page.text, names).join("\n"), revid };
  return { text: page.text, revid };
}

const profileJson = (profile: CharacterProfile | null) => (profile === null ? null : JSON.stringify(profile));

type Redraft = { profile?: { value: CharacterProfile | null; stamp: string | null }; highlights?: string };

/** Spec §34.4: both drafts with one ledger; a failed part keeps what is stored, as ingest does. */
async function redraft(
  deps: RoundDeps,
  roundId: number,
  estimated: number,
  text: string,
  onProgress: (label: string, status: RoundProgress["status"], cost: number) => void,
): Promise<Redraft> {
  const itemId = await addItem(deps.pool, roundId, { action: "redrafted", label: "Highlights and character", passages: null, estimated, cost: null });
  onProgress("Highlights and character", "started", 0);
  const ledger = new CostLedger();
  const [profile, highlights] = await Promise.allSettled([deps.generateProfile(ledger)(text), deps.draftHighlights(ledger)(text)]);
  const cost = await deps.onItemCalls(itemId, ledger.calls);
  await setItemCost(deps.pool, itemId, cost);

  const result: Redraft = {};
  if (profile.status === "fulfilled") result.profile = { value: profile.value, stamp: profileStamp() };
  else console.error(`Character redraft failed; keeping the stored one. ${String(profile.reason)}`);
  if (highlights.status === "fulfilled") result.highlights = highlights.value;
  else console.error(`Highlights redraft failed; keeping the stored ones. ${String(highlights.reason)}`);
  const label =
    result.profile && result.highlights !== undefined
      ? "Highlights and character redrafted"
      : result.profile
        ? "Character redrafted; the highlights draft failed"
        : result.highlights !== undefined
          ? "Highlights redrafted; the character draft failed"
          : "Redraft failed";
  await updateItem(deps.pool, itemId, { label, passages: null });
  onProgress(label, "finished", cost);
  return result;
}

/** Spec §18.4, §34.5: a pinned list wins; else Wikidata, or the English fallback when it lists none. A failed lookup stores nothing. */
async function newLanguages(entry: PersonaEntry, qid: string, fetchLanguages: RoundDeps["fetchLanguages"]) {
  if (entry.languages) return { languages: entry.languages, source: "curated" };
  try {
    const languages = await fetchLanguages(qid);
    return { languages, source: languages.length ? "wikidata" : "fallback" };
  } catch (err) {
    console.error(`Languages for ${entry.slug} failed. ${err instanceof Error ? err.message : String(err)}`);
    return { languages: null, source: null };
  }
}

export async function runRound(
  target: RoundTarget,
  plan: SourcePlan,
  adminId: string,
  deps: RoundDeps,
  onProgress: (p: RoundProgress) => void = () => {},
): Promise<RoundResult> {
  const { pool } = deps;
  const slug = target.kind === "existing" ? target.persona.slug : target.entry.slug;
  let roundId: number;
  try {
    roundId = await startRound(pool, slug, adminId);
  } catch (err) {
    if (err instanceof RoundBusyError) throw new RoundError("round_running", err.message);
    throw err;
  }

  let spent = 0;
  const progress = (label: string, status: RoundProgress["status"], cost = 0) => {
    spent += cost;
    onProgress({ label, status, spent });
  };
  /** Added or replaced items not yet paid for: on failure they cost nothing. */
  const unpaid = new Set<number>();
  let claimedId: number | null = null;
  try {
    const current: StoredSource[] = target.kind === "existing" ? await listSources(pool, target.persona.id) : [];
    const storedByKey = new Map(current.map((s) => [sourceKey(s), s]));
    const changes = planChanges(current, plan);
    const estimates = new Map(plan.extras.map((e) => [sourceKey(e), e.estimated]));

    const incoming: Incoming[] = [];
    const removedIds: number[] = [];
    for (const change of changes) {
      if (change.action === "kept" || change.action === "removed") {
        const stored = storedByKey.get(sourceKey(change.ref))!;
        const label = itemLabel(change, stored.passages);
        await addItem(pool, roundId, { action: change.action, label, passages: stored.passages, estimated: null, cost: 0 });
        if (change.action === "removed") removedIds.push(stored.id);
        else progress(label, "finished");
        continue;
      }
      if (change.replaces) removedIds.push(storedByKey.get(sourceKey(change.replaces))!.id);
      const estimated = change.ref.kind === "article" ? plan.articleEstimated : (estimates.get(sourceKey(change.ref)) ?? 0);
      const label = itemLabel(change, null);
      const itemId = await addItem(pool, roundId, { action: change.action, label, passages: null, estimated, cost: null });
      unpaid.add(itemId);
      incoming.push({ change, itemId, estimated, label, revid: null, text: "", chunks: [], vectors: [] });
    }

    // Free: every text is fetched and sized before any paid call.
    const names = [
      ...new Set(
        target.kind === "existing"
          ? [target.persona.displayName, target.persona.wikipediaTitle, plan.article.title]
          : [target.entry.displayName ?? target.entry.wikipediaTitle, target.entry.wikipediaTitle, plan.article.title],
      ),
    ];
    if (incoming.length) progress("Fetching texts", "started");
    for (const item of incoming) {
      const fetched = await fetchText(deps.client, item.change.ref, names);
      if (!fetched) continue;
      if (fetched.text.length > MAX_ARTICLE_CHARS) {
        throw new RoundError("too_large", `"${item.change.ref.title}" is too long to ingest (over ${MAX_ARTICLE_CHARS.toLocaleString("en")} characters).`);
      }
      item.text = fetched.text;
      item.revid = fetched.revid;
    }
    if (incoming.length) progress("Fetching texts", "finished");
    const total = incoming.reduce((sum, i) => sum + i.text.length, 0);
    if (total > MAX_ROUND_CHARS) {
      throw new RoundError(
        "too_large",
        `This round adds ${total.toLocaleString("en")} characters of new text; the limit is ${MAX_ROUND_CHARS.toLocaleString("en")}. Untick some sources.`,
      );
    }

    for (const item of incoming) {
      const { ref } = item.change;
      item.chunks = item.text ? await chunkSource(ref.kind, ref.title, item.text, ref.language) : [];
      if (item.chunks.length === 0) {
        if (ref.kind === "article") throw new RoundError("empty_article", `"${ref.title}" has no article text to embed.`);
        item.label = `${item.label} had nothing to add`;
        await updateItem(pool, item.itemId, { label: item.label, passages: 0 });
        await setItemCost(pool, item.itemId, 0);
        unpaid.delete(item.itemId);
        progress(item.label, "skipped");
        continue;
      }
      item.label = itemLabel(item.change, item.chunks.length);
      await updateItem(pool, item.itemId, { label: item.label, passages: item.chunks.length });
    }
    const toEmbed = incoming.filter((i) => i.chunks.length > 0);

    for (const item of toEmbed) {
      progress(item.label, "started");
      unpaid.delete(item.itemId);
      const ledger = new CostLedger();
      const vectors = await deps.embeddings(ledger).embedDocuments(item.chunks.map((c) => c.content));
      const cost = await deps.onItemCalls(item.itemId, ledger.calls);
      await setItemCost(pool, item.itemId, cost);
      assertDimensions(vectors);
      item.vectors = vectors;
      progress(item.label, "finished", cost);
    }

    const newArticle = toEmbed.find((i) => i.change.ref.kind === "article");
    const articleText = newArticle?.text ?? (target.kind === "existing" ? target.persona.sourceText : null);
    const pinned = target.kind === "new" ? target.entry.profile : undefined;
    let drafted: Redraft = {};
    if (plan.redraft || (target.kind === "new" && !pinned)) {
      if (!articleText) throw new RoundError("empty_article", `"${plan.article.title}" has no article text to draft from.`);
      drafted = await redraft(deps, roundId, plan.redraftEstimated, articleText, progress);
    } else if (pinned) {
      drafted = { profile: { value: pinned, stamp: CURATED_PROFILE_STAMP } };
    }
    const languages = target.kind === "new" ? await newLanguages(target.entry, target.qid, deps.fetchLanguages) : null;

    // The swap: old or new memory, never half.
    if (target.kind === "new") claimedId = await claim(pool, target.entry);
    const personaId = target.kind === "existing" ? target.persona.id : claimedId!;
    const db = await pool.connect();
    try {
      await db.query("BEGIN");
      const locked = await db.query("SELECT id FROM personas WHERE id = $1 FOR UPDATE", [personaId]);
      if (!locked.rows[0]) throw new RoundError("persona_gone", "The persona was deleted while the round ran; nothing was saved.");
      // Their chunks cascade.
      await db.query("DELETE FROM persona_sources WHERE persona_id = $1 AND id = ANY($2::int[])", [personaId, removedIds]);
      if (newArticle) await db.query("DELETE FROM chunks WHERE persona_id = $1 AND source_id IS NULL", [personaId]);
      for (const item of toEmbed) {
        const sourceId = await insertSource(db, personaId, roundId, { ...item.change.ref, revid: item.revid, passages: item.chunks.length });
        await insertChunks(db, personaId, sourceId, item.chunks, item.vectors);
      }

      const values: unknown[] = [personaId];
      const sets = ["status = 'ready'", "ingested_at = now()", "updated_at = now()"];
      const set = (column: string, value: unknown, cast = "") => {
        values.push(value);
        sets.push(`${column} = $${values.length}${cast}`);
      };
      if (newArticle) {
        set("wikipedia_title", plan.article.title);
        set("wikipedia_revid", newArticle.revid);
        set("source_text", newArticle.text);
      }
      if (drafted.profile) {
        set("profile", profileJson(drafted.profile.value), "::jsonb");
        set("profile_stamp", drafted.profile.stamp);
      }
      if (drafted.highlights !== undefined) set("highlights", drafted.highlights);
      if (target.kind === "new") {
        const { entry } = target;
        set("display_name", entry.displayName ?? plan.article.title);
        set("description", entry.description ?? "");
        set("lifespan", entry.lifespan ?? "");
        set("origin", entry.origin);
        set("wikidata_qid", target.qid);
        set("build_stamp", BUILD_STAMP);
        set("languages", languages!.languages === null ? null : JSON.stringify(languages!.languages), "::jsonb");
        set("languages_source", languages!.source);
      }
      await db.query(`UPDATE personas SET ${sets.join(", ")} WHERE id = $1`, values);
      await db.query("COMMIT");
    } catch (err) {
      await db.query("ROLLBACK");
      throw err;
    } finally {
      db.release();
    }
    for (const change of changes) if (change.action === "removed") progress(itemLabel(change, storedByKey.get(sourceKey(change.ref))!.passages), "finished");

    const persona = await findPersona(pool, slug);
    if (!persona) throw new RoundError("persona_gone", "The persona was deleted as the round finished.");
    const { rows } = await pool.query<{ n: number }>("SELECT count(*)::int AS n FROM chunks WHERE persona_id = $1", [persona.id]);
    await finishRound(pool, roundId, "done");
    return { roundId, persona, cost: spent, passages: rows[0].n };
  } catch (err) {
    await finishRound(pool, roundId, "failed");
    if (unpaid.size) await pool.query("UPDATE ingest_round_items SET cost = 0 WHERE id = ANY($1::int[])", [[...unpaid]]);
    if (claimedId !== null) {
      await pool.query("UPDATE personas SET status = 'failed', updated_at = now() WHERE id = $1 AND status = 'ingesting'", [claimedId]);
    }
    throw err;
  }
}
