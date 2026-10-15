import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import { closePool, getPool } from "../../corpus/db";
import { RECALL_FALLBACK_SCORE, searchBiography, type SearchDeps } from "../../mcp-server/biography/search-biography";
import { insertChunks, insertPersona, resetDb } from "../helpers/db";
import { TableEmbeddings } from "../helpers/fake-embeddings";

/** A unit vector along one axis: two different axes score 0, the same axis 1. */
const axis = (i: number) => Array.from({ length: 1536 }, (_, j) => (j === i ? 1 : 0));
/** A unit vector whose similarity with axis(0) is exactly `score`. */
const scoring = (score: number) => axis(0).map((v, j) => (j === 0 ? score : j === 1 ? Math.sqrt(1 - score * score) : v));

const recalled = { known: true, account: "Students killed in São Paulo in May 1932, protesting against his government.", year: 1932, confidence: "high" };

function deps(query: number[], overrides: Partial<SearchDeps> = {}): SearchDeps & { recallTopic: ReturnType<typeof vi.fn> } {
  return {
    pool: getPool(),
    embeddings: new TableEmbeddings({ q: query }),
    expandQuery: async () => [],
    recallTopic: vi.fn(async () => recalled),
    ...overrides,
  } as SearchDeps & { recallTopic: ReturnType<typeof vi.fn> };
}

const input = { query: "q", persona_id: "vargas" };

beforeEach(async () => {
  await resetDb();
  const id = await insertPersona({ slug: "vargas", lifespan: "1882–1954" });
  await insertChunks(id, [axis(0)]);
});
afterAll(() => closePool());

describe("searchBiography's recall fallback", () => {
  it("doesn't recall when the biography has a close passage", async () => {
    const d = deps(scoring(RECALL_FALLBACK_SCORE + 0.05));
    const result = await searchBiography(d, input);
    expect(d.recallTopic).not.toHaveBeenCalled();
    expect(result).not.toHaveProperty("recalled");
  });

  it("adds what recall knows when the best passage is a weak match, keeping the passages", async () => {
    const d = deps(scoring(RECALL_FALLBACK_SCORE - 0.05));
    const result = await searchBiography(d, input);
    expect(d.recallTopic).toHaveBeenCalledWith("q", expect.objectContaining({ lifespan: "1882–1954" }), expect.objectContaining({ timeoutMs: 10_000 }));
    expect(result).toMatchObject({ status: "ok", recalled: { account: recalled.account, year: 1932 } });
    if (result.status === "ok") expect(result.passages).toHaveLength(1);
  });

  it("adds what recall knows when the persona has no passages at all", async () => {
    const id = await insertPersona({ slug: "empty", lifespan: "1882–1954" });
    expect(id).toBeGreaterThan(0);
    const result = await searchBiography(deps(axis(0)), { query: "q", persona_id: "empty" });
    expect(result).toMatchObject({ status: "empty", recalled: { year: 1932 } });
  });

  it("keeps the plain result when recall doesn't know, fails or is dated after the death", async () => {
    for (const recallTopic of [
      vi.fn(async () => ({ ...recalled, known: false })),
      vi.fn(async () => ({ ...recalled, year: 1960 })),
      vi.fn(async () => {
        throw new Error("timeout");
      }),
    ]) {
      const result = await searchBiography(deps(axis(5), { recallTopic }), input);
      expect(recallTopic).toHaveBeenCalled();
      expect(result.status).toBe("ok");
      expect(result).not.toHaveProperty("recalled");
    }
  });

  it("passes the MCP call's cancellation to recall", async () => {
    const d = deps(axis(5));
    const stop = new AbortController();
    await searchBiography(d, input, stop.signal);
    const { signal } = d.recallTopic.mock.calls[0][2] as { signal: AbortSignal };
    stop.abort();
    expect(signal.aborted).toBe(true);
  });

  it("doesn't recall for an unavailable persona", async () => {
    const d = deps(axis(5));
    expect(await searchBiography(d, { query: "q", persona_id: "nobody" })).toMatchObject({ status: "unavailable" });
    expect(d.recallTopic).not.toHaveBeenCalled();
  });
});
