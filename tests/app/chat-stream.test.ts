import { describe, expect, it, vi } from "vitest";
import type { ChatStreamEvent } from "@/lib/chat-types";
import type { TurnEvent } from "@/lib/server/agent";
import { chatEvents, describeTurnError, sourcesFrom } from "@/lib/server/chat-stream";

async function* turn(events: TurnEvent[], thenThrow?: unknown): AsyncGenerator<TurnEvent> {
  for (const e of events) yield e;
  if (thenThrow) throw thenThrow;
}

async function collect(events: AsyncIterable<ChatStreamEvent>): Promise<ChatStreamEvent[]> {
  const out: ChatStreamEvent[] = [];
  for await (const e of events) out.push(e);
  return out;
}

const passage = (id: number) => ({ chunk_id: id, section_heading: `Section ${id}`, content: `text ${id}` });
const searchResult = (...ids: number[]) => ({ status: "ok", passages: ids.map(passage), queries: ["parity"] });
const clock = (...times: number[]) => () => times.shift() ?? 0;

describe("chatEvents", () => {
  it("forwards tokens and tool events, then the assembled message", async () => {
    const verdict = { status: "ok", verdict: "supported", passage: passage(2), explanation: "x" };
    const events = await collect(
      chatEvents({
        personaId: "wu",
        now: clock(100, 350, 400, 1400),
        turn: turn([
          { type: "tool_start", id: "s1", toolName: "search_biography", arguments: { query: "parity" } },
          { type: "tool_end", id: "s1", envelope: { ok: true, data: searchResult(1, 2) } },
          { type: "tool_start", id: "f1", toolName: "fact_check_claim", arguments: { claim: "I did it" } },
          { type: "tool_end", id: "f1", envelope: { ok: true, data: verdict } },
          { type: "token", text: "I " },
          { type: "token", text: "did." },
        ]),
      }),
    );
    expect(events).toEqual([
      { type: "tool_start", id: "s1", toolName: "search_biography", arguments: { query: "parity" } },
      { type: "tool_end", id: "s1", status: "ok", result: searchResult(1, 2), durationMs: 250 },
      { type: "tool_start", id: "f1", toolName: "fact_check_claim", arguments: { claim: "I did it" } },
      { type: "tool_end", id: "f1", status: "ok", result: verdict, durationMs: 1000 },
      { type: "token", text: "I " },
      { type: "token", text: "did." },
      {
        type: "done",
        message: {
          text: "I did.",
          toolCalls: [
            { id: "s1", toolName: "search_biography", arguments: { query: "parity" }, status: "ok", result: searchResult(1, 2), durationMs: 250 },
            { id: "f1", toolName: "fact_check_claim", arguments: { claim: "I did it" }, status: "ok", result: verdict, durationMs: 1000 },
          ],
          sources: [
            { personaId: "wu", sectionHeading: "Section 1", chunkId: 1 },
            { personaId: "wu", sectionHeading: "Section 2", chunkId: 2 },
          ],
        },
      },
    ]);
  });

  // F4: tokens from separate model steps run together otherwise ("Let me check.I joined…").
  it("inserts a blank-line separator between text before a tool call and text after it", async () => {
    const events = await collect(
      chatEvents({
        personaId: "wu",
        turn: turn([
          { type: "token", text: "Let me check." },
          { type: "tool_start", id: "s1", toolName: "search_biography", arguments: { query: "q" } },
          { type: "tool_end", id: "s1", envelope: { ok: true, data: searchResult(1) } },
          { type: "token", text: "I joined in 1912." },
        ]),
      }),
    );
    const tokens = events.filter((e) => e.type === "token").map((e) => (e as { text: string }).text);
    expect(tokens).toEqual(["Let me check.", "\n\n", "I joined in 1912."]);
    expect(events.at(-1)).toMatchObject({ type: "done", message: { text: "Let me check.\n\nI joined in 1912." } });
  });

  it("doesn't insert a separator when the text before a tool call already ends with whitespace", async () => {
    const events = await collect(
      chatEvents({
        personaId: "wu",
        turn: turn([
          { type: "token", text: "Let me check.\n" },
          { type: "tool_start", id: "s1", toolName: "search_biography", arguments: { query: "q" } },
          { type: "tool_end", id: "s1", envelope: { ok: true, data: searchResult(1) } },
          { type: "token", text: "I joined in 1912." },
        ]),
      }),
    );
    const tokens = events.filter((e) => e.type === "token").map((e) => (e as { text: string }).text);
    expect(tokens).toEqual(["Let me check.\n", "I joined in 1912."]);
  });

  it("marks a failed tool call as an error and cites nothing from it", async () => {
    const events = await collect(
      chatEvents({
        personaId: "wu",
        now: clock(0, 30),
        turn: turn([
          { type: "tool_start", id: "s1", toolName: "search_biography", arguments: { query: "q" } },
          { type: "tool_end", id: "s1", envelope: { ok: false, error: "Not connected" } },
          { type: "token", text: "I don't recall." },
        ]),
      }),
    );
    expect(events[1]).toEqual({ type: "tool_end", id: "s1", status: "error", result: { error: "Not connected" }, durationMs: 30 });
    expect(events.at(-1)).toMatchObject({ type: "done", message: { sources: [] } });
  });

  it("marks a tool call that never finished as an error", async () => {
    const events = await collect(
      chatEvents({
        personaId: "wu",
        turn: turn([
          { type: "tool_start", id: "s1", toolName: "search_biography", arguments: { query: "q" } },
          { type: "token", text: "Hello." },
        ]),
      }),
    );
    expect(events.at(-1)).toMatchObject({ type: "done", message: { toolCalls: [{ id: "s1", status: "error" }] } });
  });

  // Review Focus 5: no empty persona bubble.
  it("turns an answer without text into a retryable error", async () => {
    const events = await collect(chatEvents({ personaId: "wu", turn: turn([]) }));
    expect(events).toEqual([{ type: "error", reason: expect.stringMatching(/didn't answer/), retryable: true }]);
  });

  it("reports the step limit as a retryable error", async () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    const limit = Object.assign(new Error("Model call limits exceeded"), { name: "ModelCallLimitMiddlewareError" });
    const events = await collect(chatEvents({ personaId: "wu", turn: turn([], limit) }));
    expect(events).toEqual([{ type: "error", reason: expect.stringMatching(/stuck/), retryable: true }]);
    error.mockRestore();
  });

  it("ends quietly when the turn is aborted", async () => {
    const events = await collect(
      chatEvents({ personaId: "wu", turn: turn([{ type: "token", text: "I" }], new DOMException("aborted", "AbortError")) }),
    );
    expect(events).toEqual([{ type: "token", text: "I" }]);
  });
});

describe("describeTurnError", () => {
  it("makes rate limits and outages retryable, bad keys and bad models not", () => {
    expect(describeTurnError(Object.assign(new Error("x"), { status: 429 }))).toMatchObject({ retryable: true });
    expect(describeTurnError(Object.assign(new Error("x"), { status: 503 }))).toMatchObject({ retryable: true });
    expect(describeTurnError(Object.assign(new Error("x"), { status: 401 }))).toEqual({
      reason: expect.stringMatching(/OPENROUTER_API_KEY/),
      retryable: false,
    });
    expect(describeTurnError(Object.assign(new Error("x"), { status: 404 }))).toEqual({
      reason: expect.stringMatching(/AGENT_MODEL/),
      retryable: false,
    });
    expect(describeTurnError(new Error("socket hang up"))).toMatchObject({ retryable: true });
  });
});

describe("sourcesFrom", () => {
  it("ignores results without passages", () => {
    expect(
      sourcesFrom(
        [
          { id: "a", toolName: "search_biography", arguments: {}, status: "ok", result: { status: "empty", queries: [] } },
          { id: "b", toolName: "search_biography", arguments: {}, status: "ok", result: { status: "unavailable", reason: "x" } },
        ],
        "wu",
      ),
    ).toEqual([]);
  });
});

describe("chatEvents: endings (spec §18.5)", () => {
  async function* reply(): AsyncGenerator<TurnEvent> {
    yield { type: "token", text: "Good day to you." };
  }
  async function collect(ended?: "farewell" | "tired" | "offended" | null) {
    const out: ChatStreamEvent[] = [];
    for await (const e of chatEvents({ turn: reply(), personaId: "wu", ended })) out.push(e);
    return out;
  }

  it("puts the ending on the finished message", async () => {
    expect((await collect("offended")).at(-1)).toMatchObject({ type: "done", message: { ended: "offended" } });
  });

  it("leaves it off when there is none", async () => {
    const done = (await collect(null)).at(-1);
    expect(done?.type === "done" && "ended" in done.message).toBe(false);
  });
});
