import type { Pool, PoolClient } from "pg";
import { languagesOrFallback, parseStoredLanguages, type PersonaLanguage } from "./languages";
import { parseStoredProfile, type CharacterProfile } from "./profile";

export type PersonaOrigin = "curated" | "user";
export type PersonaStatus = "ingesting" | "ready" | "failed";
export type Queryable = Pool | PoolClient;

export type PersonaSummary = {
  slug: string;
  displayName: string;
  description: string;
  lifespan: string;
  origin: PersonaOrigin;
};

export type PersonaRow = PersonaSummary & {
  id: number;
  wikipediaTitle: string;
  wikipediaRevid: number | null;
  wikidataQid: string | null;
  sourceText: string | null;
  profile: CharacterProfile | null;
  profileStamp: string | null;
  status: PersonaStatus;
  buildStamp: string | null;
  updatedAt: Date;
  /** Spec §18.4: never empty, English when none are known. Read by the chat route. */
  languages: PersonaLanguage[];
  /** The stored value: null until fetched (or after a failed lookup). Ingest compares this one. */
  storedLanguages: PersonaLanguage[] | null;
};

type DbRow = {
  id: number;
  slug: string;
  display_name: string;
  description: string;
  lifespan: string;
  origin: PersonaOrigin;
  wikipedia_title: string;
  wikipedia_revid: string | null; // bigint arrives as a string
  wikidata_qid: string | null;
  source_text: string | null;
  profile: unknown; // jsonb arrives parsed
  profile_stamp: string | null;
  status: PersonaStatus;
  build_stamp: string | null;
  updated_at: Date;
  languages: unknown;
};

function fromDb(row: DbRow): PersonaRow {
  return {
    id: row.id,
    slug: row.slug,
    displayName: row.display_name,
    description: row.description,
    lifespan: row.lifespan,
    origin: row.origin,
    wikipediaTitle: row.wikipedia_title,
    wikipediaRevid: row.wikipedia_revid === null ? null : Number(row.wikipedia_revid),
    wikidataQid: row.wikidata_qid,
    sourceText: row.source_text,
    profile: parseStoredProfile(row.profile),
    profileStamp: row.profile_stamp,
    status: row.status,
    buildStamp: row.build_stamp,
    updatedAt: row.updated_at,
    languages: languagesOrFallback(parseStoredLanguages(row.languages)),
    storedLanguages: parseStoredLanguages(row.languages),
  };
}

export function toSummary(row: PersonaRow): PersonaSummary {
  const { slug, displayName, description, lifespan, origin } = row;
  return { slug, displayName, description, lifespan, origin };
}

export async function findPersona(db: Queryable, slug: string): Promise<PersonaRow | null> {
  const { rows } = await db.query<DbRow>("SELECT * FROM personas WHERE slug = $1", [slug]);
  return rows[0] ? fromDb(rows[0]) : null;
}

export async function listReadyPersonas(db: Queryable): Promise<PersonaSummary[]> {
  const { rows } = await db.query<DbRow>(
    "SELECT * FROM personas WHERE status = 'ready' ORDER BY origin = 'user', id",
  );
  return rows.map((row) => toSummary(fromDb(row)));
}

/**
 * Spec §18.4: fills in languages for a persona added before they were fetched. Writes only while
 * the stored value is still null, so a concurrent ingest's list wins.
 */
export async function storeLanguages(db: Queryable, id: number, languages: PersonaLanguage[]): Promise<void> {
  await db.query("UPDATE personas SET languages = $2::jsonb WHERE id = $1 AND languages IS NULL", [id, JSON.stringify(languages)]);
}

/** Curated personas are never deleted; the caller turns "curated" into a 403. */
export async function deletePersona(db: Queryable, slug: string): Promise<"deleted" | "not_found" | "curated"> {
  const { rowCount } = await db.query("DELETE FROM personas WHERE slug = $1 AND origin = 'user'", [slug]);
  if (rowCount) return "deleted";
  return (await findPersona(db, slug)) ? "curated" : "not_found";
}
