import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { closePool, getPool } from "../../corpus/db";
import { searchChunks } from "../../corpus/search";
import { insertChunks, insertPersona, resetDb } from "../helpers/db";
import { vectorFor } from "../helpers/fake-embeddings";

/** A vector near `base`, with a little deterministic noise. Rounded to keep the SQL payload small. */
function near(base: number[], seed: number): number[] {
  return base.map((x, i) => Number((x + 0.05 * Math.sin(seed * 7 + i)).toFixed(3)));
}

beforeEach(() => resetDb());
afterAll(() => closePool());

describe("searchChunks", () => {
  it("returns only the persona's chunks, best match first", async () => {
    const wu = await insertPersona({ slug: "wu" });
    const other = await insertPersona({ slug: "other" });
    const query = vectorFor("parity");
    await insertChunks(wu, [vectorFor("unrelated"), near(query, 1)]);
    await insertChunks(other, [query]);

    const hits = await searchChunks(getPool(), { personaSlug: "wu", embedding: query, topK: 5 });
    expect(hits).toHaveLength(2);
    expect(hits[0].content).toBe("chunk 1");
    expect(hits[0].score).toBeGreaterThan(hits[1].score);
  });

  it("returns the language of each chunk's source, English when it has none", async () => {
    const id = await insertPersona({ slug: "vargas" });
    const { rows: round } = await getPool().query(
      `INSERT INTO ingest_rounds (persona_slug, number, status, started_by) VALUES ('vargas', 1, 'done', 'test') RETURNING id`,
    );
    const { rows: src } = await getPool().query(
      `INSERT INTO persona_sources (persona_id, kind, language, site, title, url, passages, round_id)
       VALUES ($1, 'article', 'pt', 'wikipedia', 'Getúlio Vargas', 'https://pt.wikipedia.org/wiki/G', 1, $2) RETURNING id`,
      [id, round[0].id],
    );
    const query = vectorFor("language");
    await insertChunks(id, [query, near(query, 1)]);
    await getPool().query(`UPDATE chunks SET source_id = $1 WHERE persona_id = $2 AND ordinal = 0`, [src[0].id, id]);

    const hits = await searchChunks(getPool(), { personaSlug: "vargas", embedding: query, topK: 5 });
    expect(hits.map((h) => [h.content, h.language])).toEqual([
      ["chunk 0", "pt"],
      ["chunk 1", "en"],
    ]);
  });

  it("ignores personas that are not ready", async () => {
    const half = await insertPersona({ slug: "half", status: "ingesting" });
    await insertChunks(half, [vectorFor("a")]);
    expect(await searchChunks(getPool(), { personaSlug: "half", embedding: vectorFor("a"), topK: 3 })).toEqual([]);
  });

  // Spec §5 HNSW filter pitfall: a small persona surrounded by many closer chunks
  // from other personas must still get its full top_k.
  it("returns the full top_k for a persona with a small share of the corpus", async () => {
    const base = vectorFor("einstein-ish");
    for (let p = 0; p < 5; p++) {
      const id = await insertPersona({ slug: `big-${p}` });
      await insertChunks(id, Array.from({ length: 200 }, (_, i) => near(base, p * 1000 + i)));
    }
    const small = await insertPersona({ slug: "small" });
    const opposite = base.map((x) => -x);
    await insertChunks(small, Array.from({ length: 12 }, (_, i) => near(opposite, i)));

    const hits = await searchChunks(getPool(), { personaSlug: "small", embedding: base, topK: 10 });
    expect(hits).toHaveLength(10);
  });
});
