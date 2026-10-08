import { AIMessage, HumanMessage, SystemMessage, ToolMessage, fakeModel, tool, type BaseMessage } from "langchain";
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { ChatOpenAI } from "@langchain/openai";
import { describe, expect, it } from "vitest";
import { z } from "zod";
import { LOOKUPS_USED_NOTE, MAX_TOOL_CALLS, lookupLimit, runTurn, type TurnEvent } from "@/lib/server/agent";

const envelopeTool = tool(
  async ({ query }: { query: string }) => [
    `found ${query}`,
    { ok: true, data: { status: "ok", passages: [], queries: [query] } },
  ],
  {
    name: "search_biography",
    description: "Search the biography",
    schema: z.object({ query: z.string() }),
    responseFormat: "content_and_artifact",
  },
);

/** An explicit AIMessage: fakeModel().respondWithTools would fill content with the joined inputs. */
const toolCall = (id: string) =>
  new AIMessage({ content: "", tool_calls: [{ id, name: "search_biography", args: { query: "1905" }, type: "tool_call" }] });

async function collect(turn: AsyncIterable<TurnEvent>): Promise<TurnEvent[]> {
  const out: TurnEvent[] = [];
  for await (const e of turn) out.push(e);
  return out;
}

const base = { systemPrompt: "You are Einstein.", messages: [{ role: "user" as const, content: "What happened in 1905?" }] };

describe("runTurn", () => {
  it("streams the tool call, its result and the answer", async () => {
    const model = fakeModel().respond(toolCall("t1")).respond(new AIMessage("In 1905 I wrote four papers."));
    expect(await collect(runTurn({ ...base, model, tools: [envelopeTool] }))).toEqual([
      { type: "tool_start", id: "t1", toolName: "search_biography", arguments: { query: "1905" } },
      { type: "tool_end", id: "t1", envelope: { ok: true, data: { status: "ok", passages: [], queries: ["1905"] } } },
      { type: "token", text: "In 1905 I wrote four papers." },
    ]);
  });

  it("reports a tool result without an envelope as an error", async () => {
    const plain = tool(async () => "just text", {
      name: "search_biography",
      description: "Search the biography",
      schema: z.object({ query: z.string() }),
    });
    const model = fakeModel().respond(toolCall("t1")).respond(new AIMessage("Hmm."));
    const events = await collect(runTurn({ ...base, model, tools: [plain] }));
    expect(events[1]).toEqual({ type: "tool_end", id: "t1", envelope: { ok: false, error: "just text" } });
  });

  it("rethrows model errors", async () => {
    const model = fakeModel().respond(new Error("429 Too Many Requests"));
    await expect(collect(runTurn({ ...base, model, tools: [] }))).rejects.toThrow("429");
  });

  // Spec §28.2: once the lookups are used up, the model is asked to answer without tools.
  it("lets the model answer after its last lookup", async () => {
    const model = fakeModel();
    for (let i = 0; i < MAX_TOOL_CALLS; i++) model.respond(toolCall(`t${i}`));
    model.respond(new AIMessage("That is all I remember."));
    const events = await collect(runTurn({ ...base, model, tools: [envelopeTool] }));
    expect(events.filter((e) => e.type === "tool_end")).toHaveLength(MAX_TOOL_CALLS);
    expect(events.at(-1)).toEqual({ type: "token", text: "That is all I remember." });
  });

  it("stops when the signal aborts", async () => {
    const model = fakeModel().respond(new AIMessage("never"));
    await expect(collect(runTurn({ ...base, model, tools: [], signal: AbortSignal.abort() }))).rejects.toMatchObject({
      name: "AbortError",
    });
  });
  // Spec §28.2: the cap counts calls, not rounds, so six calls in one message still run only four.
  it(`runs at most ${MAX_TOOL_CALLS} tool calls and still answers`, async () => {
    const six = new AIMessage({
      content: "",
      tool_calls: Array.from({ length: 6 }, (_, i) => ({ id: `t${i}`, name: "search_biography", args: { query: "1905" }, type: "tool_call" as const })),
    });
    const model = fakeModel().respond(six).respond(new AIMessage("Some of it is hazy."));
    const events = await collect(runTurn({ ...base, model, tools: [envelopeTool] }));
    const ends = events.filter((e): e is Extract<TurnEvent, { type: "tool_end" }> => e.type === "tool_end");
    expect(ends).toHaveLength(6);
    expect(ends.filter((e) => e.envelope.ok)).toHaveLength(MAX_TOOL_CALLS);
    expect(ends.filter((e) => !e.envelope.ok)).toEqual([
      { type: "tool_end", id: "t4", envelope: { ok: false, error: "Tool call limit exceeded. Do not make additional tool calls." } },
      { type: "tool_end", id: "t5", envelope: { ok: false, error: "Tool call limit exceeded. Do not make additional tool calls." } },
    ]);
    expect(events.at(-1)).toEqual({ type: "token", text: "Some of it is hazy." });
  });

  it("reports a model message cut off by max_tokens", async () => {
    const cut = new AIMessage({ content: "I was born in Ulm. Then we", response_metadata: { finish_reason: "length" } });
    const events = await collect(runTurn({ ...base, model: fakeModel().respond(cut), tools: [] }));
    expect(events).toEqual([
      { type: "token", text: "I was born in Ulm. Then we" },
      { type: "truncated" },
    ]);
  });

  it("doesn't report a message that finished normally", async () => {
    const done = new AIMessage({ content: "Ulm.", response_metadata: { finish_reason: "stop" } });
    const events = await collect(runTurn({ ...base, model: fakeModel().respond(done), tools: [] }));
    expect(events).toEqual([{ type: "token", text: "Ulm." }]);
  });
});

// Final review: OpenRouter may drop tool_choice for a provider that doesn't support it.
// Probe (§28.5): DeepSeek ignored tool_choice "none" and kept calling tools even with none offered.
describe("runTurn when the model still asks for a tool after its last lookup", () => {
  const callWithText = (id: string, text: string) =>
    new AIMessage({ content: text, tool_calls: [{ id, name: "search_biography", args: { query: "1905" }, type: "tool_call" }] });

  it("keeps the text and drops the extra tool call", async () => {
    const model = fakeModel();
    for (let i = 0; i < MAX_TOOL_CALLS; i++) model.respond(toolCall(`t${i}`));
    model.respond(callWithText("t4", "The rest is hazy."));
    const events = await collect(runTurn({ ...base, model, tools: [envelopeTool] }));
    expect(events.filter((e) => e.type === "tool_start")).toHaveLength(MAX_TOOL_CALLS);
    expect(events.filter((e) => e.type === "token").at(-1)).toEqual({ type: "token", text: "The rest is hazy." });
  });

  // Probe (§28.5): one of two runs came back with reasoning only and no text.
  it("asks once more when the answer after the last lookup is empty", async () => {
    const model = fakeModel();
    for (let i = 0; i < MAX_TOOL_CALLS; i++) model.respond(toolCall(`t${i}`));
    model.respond(new AIMessage("")).respond(new AIMessage("That is all I remember."));
    const events = await collect(runTurn({ ...base, model, tools: [envelopeTool] }));
    expect(events.at(-1)).toEqual({ type: "token", text: "That is all I remember." });
  });

  it("ends the turn when the retry asks for a tool again, with no further model call", async () => {
    const model = fakeModel();
    for (let i = 0; i < MAX_TOOL_CALLS; i++) model.respond(toolCall(`t${i}`));
    model.respond(toolCall("t4")).respond(toolCall("t5")).respond(new AIMessage("never asked for"));
    const events = await collect(runTurn({ ...base, model, tools: [envelopeTool] }));
    expect(events.filter((e) => e.type === "tool_start")).toHaveLength(MAX_TOOL_CALLS);
    expect(events.some((e) => e.type === "token")).toBe(false);
  });
});

// Final review: the limits interact across rounds — 3 run, then 1 of the next 3, then the answer.
describe("runTurn with lookups spread over rounds", () => {
  const calls = (...ids: string[]) =>
    new AIMessage({ content: "", tool_calls: ids.map((id) => ({ id, name: "search_biography", args: { query: "1905" }, type: "tool_call" as const })) });

  it(`still runs only ${MAX_TOOL_CALLS} and answers`, async () => {
    const model = fakeModel().respond(calls("a", "b", "c")).respond(calls("d", "e", "f")).respond(new AIMessage("Enough of that."));
    const events = await collect(runTurn({ ...base, model, tools: [envelopeTool] }));
    const ends = events.filter((e): e is Extract<TurnEvent, { type: "tool_end" }> => e.type === "tool_end");
    expect(ends.filter((e) => e.envelope.ok).map((e) => e.id)).toEqual(["a", "b", "c", "d"]);
    expect(ends.filter((e) => !e.envelope.ok).map((e) => e.id)).toEqual(["e", "f"]);
    expect(events.at(-1)).toEqual({ type: "token", text: "Enough of that." });
  });
});

describe("lookupLimit", () => {
  const ran = (n: number) => Array.from({ length: n }, (_, i) => new ToolMessage({ content: "x", tool_call_id: `t${i}` }));
  type Seen = { tools: unknown[]; toolChoice?: unknown; messages: BaseMessage[] };
  async function requestFor(messages: BaseMessage[]): Promise<Seen> {
    let seen: Seen | null = null;
    const hook = lookupLimit.wrapModelCall!;
    await hook({ messages, tools: [envelopeTool], toolChoice: undefined } as never, ((req: Seen) => {
      seen = req;
      return new AIMessage("ok");
    }) as never);
    return seen!;
  }

  it(`passes the request through until ${MAX_TOOL_CALLS} lookups have run in this turn`, async () => {
    const messages = [new HumanMessage("hi"), ...ran(MAX_TOOL_CALLS - 1)];
    const seen = await requestFor(messages);
    expect(seen.tools).toHaveLength(1);
    expect(seen.messages).toBe(messages);
  });

  // Phase 4 pilot: DeepSeek answers nothing (3 of 3) to a request that ends in a system message and offers
  // no tools; with the same note as a user message it answered in character.
  it("then offers no tools and says so in a closing note sent as a user message, never a trailing system message", async () => {
    const messages = [new HumanMessage("hi"), ...ran(MAX_TOOL_CALLS)];
    const seen = await requestFor(messages);
    expect(seen.tools).toEqual([]);
    expect(seen.toolChoice).toBeUndefined();
    expect(seen.messages.slice(0, -1)).toEqual(messages);
    expect(seen.messages.at(-1)).toBeInstanceOf(HumanMessage);
    expect(seen.messages.at(-1)).not.toBeInstanceOf(SystemMessage);
    expect(seen.messages.at(-1)!.content).toBe(LOOKUPS_USED_NOTE);
  });

  it("counts only the current turn's lookups", async () => {
    const seen = await requestFor([new HumanMessage("a"), ...ran(MAX_TOOL_CALLS), new AIMessage("b"), new HumanMessage("c")]);
    expect(seen.tools).toHaveLength(1);
  });
});

// Final review: a streamed ChatOpenAI reply keeps finish_reason in generationInfo, not response_metadata.
describe("runTurn against a streaming OpenAI-compatible server", () => {
  async function withServer(chunks: object[], body: (baseURL: string) => Promise<void>) {
    const server = createServer((req, res) => {
      req.resume();
      req.on("end", () => {
        res.writeHead(200, { "Content-Type": "text/event-stream" });
        for (const c of chunks) res.write(`data: ${JSON.stringify(c)}\n\n`);
        res.end("data: [DONE]\n\n");
      });
    });
    await new Promise<void>((ok) => server.listen(0, "127.0.0.1", ok));
    try {
      await body(`http://127.0.0.1:${(server.address() as AddressInfo).port}/v1`);
    } finally {
      server.close();
    }
  }
  const chunk = (delta: object, finish_reason: string | null = null) => ({
    id: "c1", object: "chat.completion.chunk", created: 0, model: "m", choices: [{ index: 0, delta, finish_reason }],
  });

  it("reports a reply cut off by max_tokens", async () => {
    await withServer([chunk({ role: "assistant", content: "I was born in Ulm. Then we" }), chunk({}, "length")], async (baseURL) => {
      const model = new ChatOpenAI({ model: "m", apiKey: "k", maxRetries: 0, configuration: { baseURL } });
      const events = await collect(runTurn({ ...base, model, tools: [] }));
      expect(events).toEqual([{ type: "token", text: "I was born in Ulm. Then we" }, { type: "truncated" }]);
    });
  });

  it("doesn't report a reply that stopped normally", async () => {
    await withServer([chunk({ role: "assistant", content: "Ulm." }), chunk({}, "stop")], async (baseURL) => {
      const model = new ChatOpenAI({ model: "m", apiKey: "k", maxRetries: 0, configuration: { baseURL } });
      const events = await collect(runTurn({ ...base, model, tools: [] }));
      expect(events).toEqual([{ type: "token", text: "Ulm." }]);
    });
  });
});
