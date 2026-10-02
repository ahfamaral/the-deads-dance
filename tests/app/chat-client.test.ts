import { afterEach, describe, expect, it, vi } from "vitest";
import {
  ChatRequestError,
  applyChatEvent,
  startTurn,
  stoppedMessage,
  streamChat,
  toActs,
  toHistory,
  type TurnState,
} from "@/lib/chat-client";
import { HISTORY_WINDOW, type ChatStreamEvent, type Message } from "@/lib/chat-types";

afterEach(() => vi.unstubAllGlobals());

const user: Message = { id: "u1", role: "user", text: "What did you discover?" };

function ndjson(events: unknown[]): Response {
  return new Response(events.map((e) => `${JSON.stringify(e)}\n`).join(""), {
    headers: { "Content-Type": "application/x-ndjson" },
  });
}

async function collect(stream: AsyncIterable<ChatStreamEvent>): Promise<ChatStreamEvent[]> {
  const out: ChatStreamEvent[] = [];
  for await (const e of stream) out.push(e);
  return out;
}

describe("applyChatEvent", () => {
  const fold = (events: ChatStreamEvent[]): TurnState => events.reduce(applyChatEvent, startTurn("p1"));

  it("builds the persona message from tokens and tool events", () => {
    const state = fold([
      { type: "tool_start", id: "t1", toolName: "search_biography", arguments: { query: "parity" } },
      { type: "token", text: "I " },
      { type: "tool_end", id: "t1", status: "ok", result: { status: "empty", queries: [] }, durationMs: 40 },
      { type: "token", text: "did." },
    ]);
    expect(state.status).toBe("streaming");
    expect(state.message).toMatchObject({
      id: "p1",
      role: "persona",
      text: "I did.",
      toolCalls: [{ id: "t1", status: "ok", durationMs: 40, result: { status: "empty", queries: [] } }],
    });
  });

  it("shows a started tool as running", () => {
    const state = fold([{ type: "tool_start", id: "t1", toolName: "search_biography", arguments: {} }]);
    expect(state.message.toolCalls).toEqual([
      { id: "t1", toolName: "search_biography", arguments: {}, status: "running" },
    ]);
  });

  it("takes the server's finished message on done, keeping the id", () => {
    const state = fold([
      { type: "token", text: "draft" },
      { type: "done", message: { text: "Final.", toolCalls: [], sources: [{ personaId: "wu", sectionHeading: "S", chunkId: 1 }] } },
    ]);
    expect(state).toMatchObject({ status: "done", message: { id: "p1", text: "Final.", sources: [{ chunkId: 1 }] } });
  });

  it("records notices and errors", () => {
    expect(fold([{ type: "notice", code: "tools_unavailable" }]).toolsUnavailable).toBe(true);
    expect(fold([{ type: "error", reason: "Rate-limited", retryable: true }])).toMatchObject({
      status: "error",
      error: { reason: "Rate-limited", retryable: true },
    });
  });
});

describe("stoppedMessage", () => {
  // Review Focus 4: Stop before the first token adds nothing.
  it("is null before any text arrived", () => {
    expect(stoppedMessage(applyChatEvent(startTurn("p1"), { type: "tool_start", id: "t1", toolName: "x", arguments: {} }))).toBeNull();
  });

  it("keeps the text so far and drops calls that were still running", () => {
    let state = startTurn("p1");
    state = applyChatEvent(state, { type: "tool_start", id: "t1", toolName: "x", arguments: {} });
    state = applyChatEvent(state, { type: "tool_end", id: "t1", status: "ok", result: {}, durationMs: 5 });
    state = applyChatEvent(state, { type: "tool_start", id: "t2", toolName: "x", arguments: {} });
    state = applyChatEvent(state, { type: "token", text: "I was" });
    expect(stoppedMessage(state)).toMatchObject({ text: "I was", toolCalls: [{ id: "t1" }] });
  });
});

describe("toHistory", () => {
  // Review Focus 3: messages saved before tool traces existed still work as history.
  it("sends role and text only, for old and new messages alike", () => {
    const old: Message = { id: "a", role: "persona", text: "Hello." };
    const withTrace: Message = { id: "b", role: "persona", text: "Hi.", toolCalls: [], sources: [] };
    expect(toHistory([user, old, withTrace])).toEqual([
      { role: "user", text: "What did you discover?" },
      { role: "persona", text: "Hello." },
      { role: "persona", text: "Hi." },
    ]);
  });

  // F1: the server only ever uses the last HISTORY_WINDOW messages; a long conversation must
  // not be sent whole, or it hits the server's 50-message cap and the turn fails permanently.
  it("sends only the last HISTORY_WINDOW messages of a long conversation", () => {
    const messages: Message[] = Array.from({ length: 60 }, (_, i) => ({
      id: `m${i}`,
      role: i % 2 === 0 ? "user" : "persona",
      text: `text ${i}`,
    }));
    const history = toHistory(messages);
    expect(history).toHaveLength(HISTORY_WINDOW);
    expect(history).toEqual(
      messages.slice(-HISTORY_WINDOW).map(({ role, text }) => ({ role, text })),
    );
    expect(history[0]).toEqual({ role: messages[40].role, text: "text 40" });
  });
});

describe("streamChat", () => {
  it("posts the persona and history, then yields the streamed events", async () => {
    const fetchMock = vi.fn(async () => ndjson([{ type: "token", text: "Hi" }]));
    vi.stubGlobal("fetch", fetchMock);
    expect(await collect(streamChat({ personaId: "wu", messages: [user] }))).toEqual([{ type: "token", text: "Hi" }]);
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("/api/chat");
    expect(JSON.parse(init.body as string)).toEqual({
      personaId: "wu",
      messages: [{ role: "user", text: user.text }],
      acts: [],
      languageMode: "realistic",
    });
  });

  // Review Focus 2: the server's reason reaches the user, and it isn't offered as retryable.
  it("throws a non-retryable error with the server's reason for a 4xx", async () => {
    vi.stubGlobal("fetch", async () =>
      Response.json({ error: "This persona is no longer available.", code: "unknown_persona" }, { status: 404 }),
    );
    await expect(collect(streamChat({ personaId: "gone", messages: [user] }))).rejects.toMatchObject({
      message: "This persona is no longer available.",
      retryable: false,
    });
  });

  it("throws a retryable error when the server can't be reached", async () => {
    vi.stubGlobal("fetch", async () => {
      throw new TypeError("fetch failed");
    });
    const error = await collect(streamChat({ personaId: "wu", messages: [user] })).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(ChatRequestError);
    expect(error).toMatchObject({ retryable: true, message: "Couldn't reach the server." });
  });

  it("throws a retryable error for a garbled stream", async () => {
    vi.stubGlobal("fetch", async () => new Response('{"type":"token","text":"Hi"}\n{not json\n'));
    await expect(collect(streamChat({ personaId: "wu", messages: [user] }))).rejects.toMatchObject({
      retryable: true,
      message: "The reply was interrupted.",
    });
  });
});

describe("toActs (spec §18.7)", () => {
  const act = { act: "question", offense: 0, sorePoint: false, language: "en", wants: "normal", visitorName: null } as const;

  it("sends the acts of every user message but the newest, persona messages skipped", () => {
    const messages: Message[] = [
      { id: "p0", role: "persona", text: "Welcome." },
      { id: "u1", role: "user", text: "Hi", act },
      { id: "p1", role: "persona", text: "Hello." },
      { id: "u2", role: "user", text: "Bye" },
    ];
    expect(toActs(messages)).toEqual([act]);
  });

  // Review Focus 2: conversations saved before §18 have no acts.
  it("sends null for messages saved before acts existed", () => {
    const old: Message[] = [
      { id: "u1", role: "user", text: "Hi" },
      { id: "p1", role: "persona", text: "Hello." },
      { id: "u2", role: "user", text: "And?" },
    ];
    expect(toActs(old)).toEqual([null]);
  });

  it("sends a malformed stored act as null", () => {
    const tampered = { ...act, offense: 7, extra: true } as unknown as typeof act;
    const messages: Message[] = [
      { id: "u1", role: "user", text: "Hi", act: tampered },
      { id: "u2", role: "user", text: "Again", act },
      { id: "u3", role: "user", text: "And?" },
    ];
    expect(toActs(messages)).toEqual([null, act]);
  });

  it("keeps only the last 500", () => {
    const many: Message[] = Array.from({ length: 502 }, (_, i) => ({ id: `u${i}`, role: "user" as const, text: "x", act }));
    expect(toActs(many)).toHaveLength(500);
  });
});

describe("applyChatEvent: act (spec §18.1)", () => {
  it("records the act on the turn, not on the persona message", () => {
    const act = { act: "thanks", offense: 0, sorePoint: false, language: "en", wants: "brief", visitorName: null } as const;
    const state = applyChatEvent(startTurn("m1"), { type: "act", act });
    expect(state.act).toEqual(act);
    expect(state.message).not.toHaveProperty("act");
  });

  it("keeps the ending the server put on the finished message", () => {
    const done = applyChatEvent(startTurn("m1"), {
      type: "done",
      message: { text: "Good day.", toolCalls: [], sources: [], ended: "offended" },
    });
    expect(done.message.ended).toBe("offended");
  });
});

describe("streamChat: behaviour fields", () => {
  it("posts acts and languageMode, and no kind", async () => {
    const fetchMock = vi.fn(async () => new Response("", { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);
    const gen = streamChat({ personaId: "wu", messages: [], languageMode: "visitor" });
    await gen.next().catch(() => {});
    const body = JSON.parse((fetchMock.mock.calls[0] as unknown as [string, RequestInit])[1].body as string);
    expect(body).toEqual({ personaId: "wu", messages: [], acts: [], languageMode: "visitor" });
    vi.unstubAllGlobals();
  });

  it("exposes the server's error code on a 409", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => Response.json({ error: "The persona has ended this conversation.", code: "conversation_ended" }, { status: 409 })),
    );
    await expect(streamChat({ personaId: "wu", messages: [{ id: "u", role: "user", text: "Hi" }] }).next()).rejects.toMatchObject({
      code: "conversation_ended",
      retryable: false,
    });
    vi.unstubAllGlobals();
  });
});
