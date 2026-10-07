import { describe, expect, it } from "vitest";
import { applyChatEvent, replyToStore, startTurn, type TurnState } from "@/lib/turn-state";
import type { ChatStreamEvent } from "@/lib/chat-types";

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

describe("replyToStore (spec §26.4)", () => {
  const running = (text: string): TurnState => {
    let s = startTurn("p1");
    s = applyChatEvent(s, { type: "tool_start", id: "t1", toolName: "search_biography", arguments: {} });
    return text ? applyChatEvent(s, { type: "token", text }) : s;
  };

  it("stores a finished reply as it is", () => {
    const done = applyChatEvent(running("Parity fails."), {
      type: "done",
      message: { text: "Parity fails.", toolCalls: [], sources: [], ended: "farewell" },
    });
    expect(replyToStore(done)).toEqual(done.message);
  });

  it("stores nothing for a failed turn, even with text, so the visitor can retry it", () => {
    const failed = applyChatEvent(running("Half an an"), { type: "error", reason: "x", retryable: true });
    expect(replyToStore(failed)).toBeNull();
  });

  it("stores nothing for a stream that ended without done or error", () => {
    expect(replyToStore(running("Odd"))).toBeNull();
  });

  it("puts the turn's cost on the reply, and ignores the energy event", () => {
    let s = startTurn("r");
    s = applyChatEvent(s, { type: "energy", left: 0.4 });
    s = applyChatEvent(s, { type: "cost", turn: { tokens: 10, cost: 5, inputTokens: 8, outputTokens: 2 }, conversation: { tokens: 10, cost: 5 } });
    expect(s.message).toMatchObject({ cost: 5, tokens: 10 });
  });
});
