import { getPool, toVectorLiteral } from "../../corpus/db";

export async function resetDb(): Promise<void> {
  await getPool().query("TRUNCATE personas RESTART IDENTITY CASCADE");
}

export type PersonaFixture = {
  slug: string;
  displayName?: string;
  origin?: "curated" | "user";
  status?: "ingesting" | "ready" | "failed";
  buildStamp?: string | null;
  sourceText?: string | null;
  updatedMinutesAgo?: number;
  description?: string;
  lifespan?: string;
  wikidataQid?: string | null;
};

export async function insertPersona(p: PersonaFixture): Promise<number> {
  const { rows } = await getPool().query(
    `INSERT INTO personas (slug, display_name, wikipedia_title, origin, status, build_stamp, source_text, updated_at, description, lifespan, wikidata_qid)
     VALUES ($1, $2, $2, $3, $4, $5, $6, now() - make_interval(mins => $7), $8, $9, $10)
     RETURNING id`,
    [
      p.slug,
      p.displayName ?? p.slug,
      p.origin ?? "curated",
      p.status ?? "ready",
      p.buildStamp ?? null,
      p.sourceText ?? null,
      p.updatedMinutesAgo ?? 0,
      p.description ?? "",
      p.lifespan ?? "",
      p.wikidataQid ?? null,
    ],
  );
  return rows[0].id;
}

export async function insertChunks(personaId: number, vectors: number[][], heading = "Test"): Promise<void> {
  await getPool().query(
    `INSERT INTO chunks (persona_id, section_heading, ordinal, content, embedding)
     SELECT $1, $2, o, 'chunk ' || o, e::vector
     FROM unnest($3::int[], $4::text[]) AS t(o, e)`,
    [personaId, heading, vectors.map((_, i) => i), vectors.map(toVectorLiteral)],
  );
}
