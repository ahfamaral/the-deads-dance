import { AIMessage, createAgent, fakeModel } from "langchain";
import { describe, expect, it } from "vitest";
import { CostLedger, estimateTokens, meteredEmbeddings, parseCalls } from "../../corpus/cost-ledger";
import { FakeEmbeddings } from "../helpers/fake-embeddings";

const billed = (text: string, cost?: number) =>
  new AIMessage({
    content: text,
    id: "gen-123",
    response_metadata: cost === undefined ? {} : { usage: { cost, prompt_tokens: 100, completion_tokens: 20 } },
    usage_metadata: { input_tokens: 100, output_tokens: 20, total_tokens: 120 },
  });

describe("CostLedger", () => {
  it("records a call's role, tokens, cost in micro-dollars and generation id", async () => {
    const ledger = new CostLedger();
    await fakeModel().respond(billed("hi", 0.0012)).invoke("hello", { callbacks: [ledger.handler("classifier")] });
    expect(ledger.calls).toEqual([
      expect.objectContaining({ role: "classifier", inputTokens: 100, outputTokens: 20, cost: 1_200, generationId: "gen-123" }),
    ]);
    expect(typeof ledger.calls[0].model).toBe("string");
    expect(ledger.calls[0].latencyMs).toBeGreaterThanOrEqual(0);
  });

  it("keeps the tokens and leaves cost null when the response has no usage.cost", async () => {
    const ledger = new CostLedger();
    await fakeModel().respond(billed("hi")).invoke("hello", { callbacks: [ledger.handler("helper")] });
    expect(ledger.calls[0]).toMatchObject({ cost: null, inputTokens: 100, outputTokens: 20 });
  });

  it("undoes LangChain's doubled usage on streamed calls (Task 0 finding)", async () => {
    const ledger = new CostLedger();
    const doubled = new AIMessage({
      content: "hi",
      id: "gen-2",
      response_metadata: { usage: { prompt_tokens: 68, completion_tokens: 92, cost: 0.000122952 } },
      usage_metadata: { input_tokens: 34, output_tokens: 46, total_tokens: 80 },
    });
    await fakeModel().respond(doubled).invoke("x", { callbacks: [ledger.handler("agent")] });
    expect(ledger.calls[0]).toMatchObject({ inputTokens: 34, outputTokens: 46, cost: 61 }); // 0.000061476 $ → 61 micro-dollars
  });

  it("sees the agent's model calls through the stream's config", async () => {
    const ledger = new CostLedger();
    const agent = createAgent({ model: fakeModel().respond(billed("I am here.", 0.002)), tools: [] });
    const stream = await agent.stream(
      { messages: [{ role: "user", content: "hi" }] },
      { streamMode: ["messages", "updates"], callbacks: [ledger.handler("agent")] },
    );
    for await (const _ of stream) void _;
    expect(ledger.calls).toEqual([expect.objectContaining({ role: "agent", cost: 2_000 })]);
  });

  it("keeps two turns' calls apart when they run at once", async () => {
    const a = new CostLedger();
    const b = new CostLedger();
    await Promise.all([
      fakeModel().respond(billed("a", 0.001)).invoke("x", { callbacks: [a.handler("agent")] }),
      fakeModel().respond(billed("b", 0.002)).invoke("y", { callbacks: [b.handler("agent")] }),
    ]);
    expect(a.calls.map((c) => c.cost)).toEqual([1_000]);
    expect(b.calls.map((c) => c.cost)).toEqual([2_000]);
  });
});

describe("parseCalls (Review Focus 4)", () => {
  it("keeps valid calls and drops the rest", () => {
    const good = { role: "helper", model: "m", inputTokens: 1, outputTokens: 2, cost: 3, generationId: null, latencyMs: 4 };
    expect(parseCalls([good, { role: "wizard" }, "junk", null])).toEqual([good]);
    expect(parseCalls(undefined)).toEqual([]);
    expect(parseCalls("not an array")).toEqual([]);
  });
});

describe("meteredEmbeddings", () => {
  it("records each embedding call with estimated tokens and no cost", async () => {
    const ledger = new CostLedger();
    const embeddings = meteredEmbeddings(new FakeEmbeddings(), ledger, "openai/text-embedding-3-small");
    await embeddings.embedDocuments(["abcd", "abcdefgh"]);
    await embeddings.embedQuery("abcd");
    expect(ledger.calls).toEqual([
      expect.objectContaining({ role: "embedding", model: "openai/text-embedding-3-small", inputTokens: 3, outputTokens: 0, cost: null }),
      expect.objectContaining({ role: "embedding", inputTokens: 1 }),
    ]);
    expect(estimateTokens("abcde")).toBe(2);
  });
});
