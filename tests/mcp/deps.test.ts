import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../corpus/db", () => ({ getPool: () => ({}) }));
vi.mock("../../corpus/models", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../corpus/models")>();
  return { ...actual, chatModel: vi.fn(actual.chatModel) };
});
vi.mock("../../corpus/embeddings", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../corpus/embeddings")>();
  return { ...actual, embeddingModel: vi.fn(actual.embeddingModel) };
});

const { chatModel } = await import("../../corpus/models");
const { embeddingModel } = await import("../../corpus/embeddings");
const { CostLedger } = await import("../../corpus/cost-ledger");
const { liveDepsFor, STEP_LIMITS } = await import("../../mcp-server/deps");
const { TOOL_TIMEOUT_MS } = await import("../../src/lib/server/mcp-client");
const { RECALL_MAX_MS } = await import("../../mcp-server/biography/fact-check");

/** A step's longest run: every try uses its whole timeout. */
const worstMs = (limit: { timeout: number; maxRetries: number }) => limit.timeout * (limit.maxRetries + 1);

// The database queries and the MCP round trip need the rest.
const STEPS_BUDGET_MS = TOOL_TIMEOUT_MS - 3_000;

const savedKey = process.env.OPENROUTER_API_KEY;
beforeEach(() => {
  process.env.OPENROUTER_API_KEY = "test-key";
  vi.mocked(chatModel).mockClear();
});
afterEach(() => {
  process.env.OPENROUTER_API_KEY = savedKey;
});

describe("step limits", () => {
  it("fit search_biography's sequential steps, recall fallback included, in the tool timeout", () => {
    expect(worstMs(STEP_LIMITS.expansion) + worstMs(STEP_LIMITS.embedding) + RECALL_MAX_MS).toBeLessThanOrEqual(STEPS_BUDGET_MS);
  });

  it("fit fact_check_claim's sequential steps in the tool timeout", () => {
    const { expansion, embedding, judge } = STEP_LIMITS;
    expect(worstMs(expansion) + worstMs(embedding) + worstMs(judge)).toBeLessThanOrEqual(STEPS_BUDGET_MS);
  });
});

describe("liveDepsFor", () => {
  it("gives the search fallback its own recall, on the recall model", () => {
    const deps = liveDepsFor()(new CostLedger());
    expect(typeof deps.recallTopic).toBe("function");
    expect(vi.mocked(chatModel).mock.calls.filter(([role]) => role === "recall")).toHaveLength(2);
  });

  it("embeds queries with the embedding step's limits", () => {
    liveDepsFor();
    expect(embeddingModel).toHaveBeenCalledWith(STEP_LIMITS.embedding);
  });

  it("builds the expansion and judge models with their steps' limits", () => {
    liveDepsFor()(new CostLedger());
    const helperOptions = vi.mocked(chatModel).mock.calls.filter(([role]) => role === "helper").map(([, options]) => options);
    expect(helperOptions).toEqual([
      // Live, 2026-10-15: on DeepSeek v4.1 flash, "minimal" and "low" reasoned 16–19 s, past the 8 s limit; "none" took 1.4–2.3 s.
      expect.objectContaining({ ...STEP_LIMITS.expansion, reasoningEffort: "none" }),
      expect.objectContaining({ ...STEP_LIMITS.expansion, reasoningEffort: "none" }),
      expect.objectContaining(STEP_LIMITS.judge),
    ]);
  });
});
