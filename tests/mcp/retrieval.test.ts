import type { BaseChatModel } from "@langchain/core/language_models/chat_models";
import { fakeModel } from "langchain";
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import { closePool, getPool } from "../../corpus/db";
import type { SearchHit } from "../../corpus/search";
import {
  candidateDepth,
  CLAIM_EXPANSION_PROMPT,
  coverEachQuery,
  EXPANSION_PROMPT,
  expandQueryWith,
  fuseRankings,
  ORIGINAL_QUERY_WEIGHT,
  retrieve,
  type RetrievalDeps,
} from "../../mcp-server/biography/retrieval";
import { insertChunks, insertPersona, resetDb } from "../helpers/db";
import {
  CONSENSUS_CHUNKS,
  CONSENSUS_QUERY,
  DETAIL_CONTENT,
  DETAIL_QUERY,
  TableEmbeddings,
  vectorFor,
} from "../helpers/fake-embeddings";

const hit = (chunkId: number): SearchHit => ({ chunkId, sectionHeading: `S${chunkId}`, content: `c${chunkId}`, score: 0 });

function deps(overrides: Partial<RetrievalDeps> = {}): RetrievalDeps {
  return { pool: getPool(), embeddings: new TableEmbeddings({}), expandQuery: async () => [], ...overrides };
}

beforeEach(() => resetDb());
afterAll(() => closePool());

describe("fuseRankings", () => {
  it("ranks a chunk found by several queries above one found by a single query", () => {
    expect(fuseRankings([[hit(1), hit(2)], [hit(2), hit(3)]]).map((h) => h.chunkId)).toEqual([2, 1, 3]);
  });

  it("breaks ties by first appearance", () => {
    expect(fuseRankings([[hit(3)], [hit(5)], [hit(4)]]).map((h) => h.chunkId)).toEqual([3, 5, 4]);
  });

  it("returns each chunk once, scored as the sum of weight / (k + rank)", () => {
    const fused = fuseRankings([[hit(1)], [hit(1)]], 60, 1);
    expect(fused).toHaveLength(1);
    expect(fused[0].score).toBeCloseTo(2 / 61);
  });

  // Variants are the helper's guesses, sometimes speculative; the original is what was asked.
  it("counts the original query (the first list) twice by default", () => {
    expect(ORIGINAL_QUERY_WEIGHT).toBe(2);
    expect(fuseRankings([[hit(1)], [hit(1)]])[0].score).toBeCloseTo(3 / 61);
    expect(fuseRankings([[hit(1)], [hit(2)], [hit(3)], [hit(2)]]).map((h) => h.chunkId)).toEqual([1, 2, 3]);
    expect(fuseRankings([[hit(1)], [hit(2)], [hit(3)], [hit(2)]], 60, 1).map((h) => h.chunkId)).toEqual([2, 1, 3]);
  });
});

// At depth 10 a chunk one variant ranks 11th loses that list's whole vote — observed live
// dropping a golden section that every other query ranked 1st–3rd.
describe("candidateDepth", () => {
  it("searches at least 20 candidates per query, or 3 × top_k", () => {
    expect(candidateDepth(1)).toBe(20);
    expect(candidateDepth(5)).toBe(20);
    expect(candidateDepth(10)).toBe(30);
  });
});

describe("coverEachQuery", () => {
  const ids = (hits: SearchHit[]) => hits.map((h) => h.chunkId);

  it("takes each query's top hit first, in query order, then fills in fused order", () => {
    const lists = [[hit(1), hit(2), hit(3)], [hit(1), hit(2), hit(3)], [hit(4), hit(2), hit(1)]];
    expect(ids(fuseRankings(lists).slice(0, 2))).toEqual([1, 2]); // 4 loses on consensus
    expect(ids(coverEachQuery(lists, 2))).toEqual([1, 4]);
    expect(ids(coverEachQuery(lists, 3))).toEqual([1, 4, 2]);
  });

  it("skips a top hit already taken and returns each chunk once", () => {
    expect(ids(coverEachQuery([[hit(1), hit(2)], [hit(1), hit(3)]], 3))).toEqual([1, 2, 3]);
  });

  it("returns at most topK hits, even with more queries", () => {
    expect(ids(coverEachQuery([[hit(1)], [hit(2)], [hit(3)]], 2))).toEqual([1, 2]);
  });
});

describe("retrieve", () => {
  it("is unavailable for an unknown or unready persona", async () => {
    await insertPersona({ slug: "half", status: "ingesting" });
    for (const slug of ["nobody", "half"]) {
      expect(await retrieve(deps(), { query: "q", personaSlug: slug, topK: 3 })).toMatchObject({
        status: "unavailable",
      });
    }
  });

  it("is empty when the persona has no chunks", async () => {
    await insertPersona({ slug: "wu" });
    expect(await retrieve(deps(), { query: "q", personaSlug: "wu", topK: 3 })).toEqual({
      status: "empty",
      queries: ["q"],
    });
  });

  it("returns passages with their section headings", async () => {
    const id = await insertPersona({ slug: "wu" });
    await insertChunks(id, [vectorFor("a"), vectorFor("b")], "Parity experiment");
    const result = await retrieve(deps(), { query: "q", personaSlug: "wu", topK: 3 });
    expect(result.status).toBe("ok");
    if (result.status !== "ok") return;
    expect(result.passages).toHaveLength(2);
    expect(result.passages[0]).toEqual({
      chunk_id: expect.any(Number),
      section_heading: "Parity experiment",
      content: expect.stringMatching(/^chunk /),
    });
  });

  it("searches the original query plus distinct, trimmed variants, at most three", async () => {
    await insertPersona({ slug: "wu" });
    const embeddings = new TableEmbeddings({});
    const result = await retrieve(deps({ embeddings, expandQuery: async () => ["a", "a", "  ", " b ", "c", "d"] }), {
      query: "q",
      personaSlug: "wu",
      topK: 3,
    });
    expect(result).toMatchObject({ queries: ["q", "a", "b", "c"] });
    expect(embeddings.texts).toEqual(["q", "a", "b", "c"]);
  });

  it("falls back to the original query when expansion fails", async () => {
    const id = await insertPersona({ slug: "wu" });
    await insertChunks(id, [vectorFor("a")]);
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    const failing = async (): Promise<string[]> => {
      throw new Error("model down");
    };
    const result = await retrieve(deps({ expandQuery: failing }), { query: "q", personaSlug: "wu", topK: 3 });
    expect(result).toMatchObject({ status: "ok", queries: ["q"] });
    expect(error).toHaveBeenCalled();
    error.mockRestore();
  });

  it("lets three agreeing variants outvote the original query", async () => {
    const id = await insertPersona({ slug: "wu" });
    const [a, b] = [vectorFor("A"), vectorFor("B")];
    await insertChunks(id, [a, b]); // contents "chunk 0" and "chunk 1"
    const embeddings = new TableEmbeddings({ q: a, v1: b, v2: b, v3: b });

    const single = await retrieve(deps({ embeddings }), { query: "q", personaSlug: "wu", topK: 1 });
    const multi = await retrieve(deps({ embeddings, expandQuery: async () => ["v1", "v2", "v3"] }), {
      query: "q",
      personaSlug: "wu",
      topK: 1,
    });

    // single: q ranks chunk 0 first. multi: chunk 1 is first for v1–v3 and second for q (counted
    // twice), so it scores 3/61 + 2/62 against chunk 0's 2/61 + 3/62.
    expect(single).toMatchObject({ passages: [{ content: "chunk 0" }] });
    expect(multi).toMatchObject({ passages: [{ content: "chunk 1" }] });
  });
});

describe("retrieve with coverEachQuery", () => {
  async function seedConsensusAndDetail(): Promise<RetrievalDeps> {
    const id = await insertPersona({ slug: "wu" });
    await insertChunks(id, CONSENSUS_CHUNKS);
    const embeddings = new TableEmbeddings({ q: CONSENSUS_QUERY, v1: CONSENSUS_QUERY, v2: CONSENSUS_QUERY, v3: DETAIL_QUERY });
    return deps({ embeddings, expandQuery: async () => ["v1", "v2", "v3"] });
  }

  it("keeps a passage only one query finds, which fusion alone drops", async () => {
    const d = await seedConsensusAndDetail();
    const fused = await retrieve(d, { query: "q", personaSlug: "wu", topK: 5 });
    const covered = await retrieve(d, { query: "q", personaSlug: "wu", topK: 5, coverEachQuery: true });
    const contents = (r: typeof fused) => (r.status === "ok" ? r.passages.map((p) => p.content) : []);
    // The order among consensus chunks depends on how the detail query breaks its ties, so
    // assert membership and the covered head only.
    expect(contents(fused)).toHaveLength(5);
    expect(contents(fused)).not.toContain(DETAIL_CONTENT);
    expect(contents(covered)).toHaveLength(5);
    expect(contents(covered).slice(0, 2)).toEqual(["chunk 0", DETAIL_CONTENT]);
  });
});

describe("expandQueryWith", () => {
  it("returns the model's structured variants", async () => {
    const expand = expandQueryWith(fakeModel().structuredResponse({ variants: ["x", "y", "z"] }));
    expect(await expand("q")).toEqual(["x", "y", "z"]);
  });

  it("sends the expansion prompt by default, or the prompt it is given", async () => {
    // fakeModel's structured runnable doesn't record its input, so capture it here.
    const systemPrompt = async (prompt?: string) => {
      let sent: { content: string }[] = [];
      const model = {
        withStructuredOutput: () => ({
          invoke: async (messages: { content: string }[]) => {
            sent = messages;
            return { variants: [] };
          },
        }),
      } as unknown as BaseChatModel;
      await expandQueryWith(model, prompt)("q");
      return sent[0].content;
    };
    expect(await systemPrompt()).toBe(EXPANSION_PROMPT);
    expect(await systemPrompt(CLAIM_EXPANSION_PROMPT)).toBe(CLAIM_EXPANSION_PROMPT);
  });

  // Every passage is about the persona, so the name matches all of them and drowns the topic.
  it("keeps the person's name and generic words out of the variants", () => {
    for (const prompt of [EXPANSION_PROMPT, CLAIM_EXPANSION_PROMPT]) {
      expect(prompt).toMatch(/leave out their name and generic words/);
    }
  });

  it("splits a claim into one query per checkable detail", () => {
    expect(CLAIM_EXPANSION_PROMPT).toMatch(/one per checkable detail/);
  });
});
