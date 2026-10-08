import { describe, expect, it, vi } from "vitest";
import type { ChatStreamEvent } from "@/lib/chat-types";
import type { TurnEvent } from "@/lib/server/agent";
import { chatEvents, describeTurnError, sourcesFrom, trimToSentence } from "@/lib/server/chat-stream";

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
  // Spec §28.2: agent middleware wraps a model error, keeping the provider's error as its cause.
  it("reads the status through a wrapping error's cause", () => {
    const wrapped = new Error("Too Many Requests", { cause: Object.assign(new Error("Too Many Requests"), { status: 429 }) });
    expect(describeTurnError(wrapped).reason).toMatch(/rate-limited/);
  });

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

it("tells the visitor the dead are resting when OpenRouter is out of credit (HTTP 402)", () => {
  expect(describeTurnError(Object.assign(new Error("Payment required"), { status: 402 }))).toEqual({
    reason: "The dead are resting right now. Try again later.",
    retryable: false,
  });
});

// Spec §28.2: a reply cut off by max_tokens ends at its last full sentence.
describe("trimToSentence", () => {
  it("cuts back to the last full sentence", () => {
    expect(trimToSentence("I was born in Ulm. Then we moved to Munich, where my fath")).toBe("I was born in Ulm.");
    expect(trimToSentence("Was it hard? Yes! And then the")).toBe("Was it hard? Yes!");
  });

  it("keeps a closing quote or bracket and an ellipsis", () => {
    expect(trimToSentence('He said "never again!" and then I wen')).toBe('He said "never again!"');
    expect(trimToSentence("He wrote “I am done.” Then he")).toBe("He wrote “I am done.”");
    expect(trimToSentence("(It was 1905.) And the")).toBe("(It was 1905.)");
    expect(trimToSentence("It was hard… and the")).toBe("It was hard…");
  });

  it("doesn't take a decimal point for a sentence end", () => {
    expect(trimToSentence("We measured 3.14 and the")).toBe("We measured 3.14 and the…");
  });

  it("doesn't take an abbreviation for a sentence end", () => {
    expect(trimToSentence("I met Mr. Lincoln and he")).toBe("I met Mr. Lincoln and he…");
    expect(trimToSentence("I was born c. 1864 in Missouri. Then we")).toBe("I was born c. 1864 in Missouri.");
    expect(trimToSentence("Falei com a Sra. Vargas e")).toBe("Falei com a Sra. Vargas e…");
    expect(trimToSentence("Dr. Planck agreed. And then the")).toBe("Dr. Planck agreed.");
    expect(trimToSentence("I was short of vitamin C. Then the")).toBe("I was short of vitamin C.");
  });

  it("trails off when there's no full sentence", () => {
    expect(trimToSentence("Well, and then we ")).toBe("Well, and then we…");
  });

  it("leaves a reply that already ends a sentence alone", () => {
    expect(trimToSentence("It was Ulm.")).toBe("It was Ulm.");
  });
});

describe("chatEvents: truncation (spec §28.2)", () => {
  it("trims a truncated reply in done, and never forwards truncated", async () => {
    const events = await collect(
      chatEvents({
        personaId: "einstein",
        turn: turn([
          { type: "token", text: "Let me think." },
          { type: "tool_start", id: "s1", toolName: "search_biography", arguments: { query: "Ulm" } },
          { type: "tool_end", id: "s1", envelope: { ok: true, data: searchResult(1) } },
          { type: "token", text: "I was born in Ulm. Then we" },
          { type: "truncated" },
        ]),
      }),
    );
    expect(events.some((e) => (e as { type: string }).type === "truncated")).toBe(false);
    const done = events.at(-1);
    expect(done).toMatchObject({ type: "done", message: { text: "Let me think.\n\nI was born in Ulm." } });
  });

  it("leaves an untruncated reply untouched, even mid-sentence", async () => {
    const events = await collect(chatEvents({ personaId: "einstein", turn: turn([{ type: "token", text: "Well, and then we" }]) }));
    expect(events.at(-1)).toMatchObject({ type: "done", message: { text: "Well, and then we" } });
  });

  it("still reports an empty truncated reply as no answer", async () => {
    const events = await collect(chatEvents({ personaId: "einstein", turn: turn([{ type: "truncated" }]) }));
    expect(events).toEqual([{ type: "error", reason: "The persona didn't answer. Try rephrasing.", retryable: true }]);
  });
});
