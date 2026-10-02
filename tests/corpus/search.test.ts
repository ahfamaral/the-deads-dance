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
