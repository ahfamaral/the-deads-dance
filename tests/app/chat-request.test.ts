import { describe, expect, it } from "vitest";
import { HISTORY_WINDOW, parseChatRequest, toAgentMessages } from "@/lib/server/chat-request";

const ID = "8f14e45f-ceea-467f-a0e6-2b8a2a6b1c11";
const base = { conversationId: ID, personaId: "wu" };

describe("parseChatRequest (spec §25.3)", () => {
  it("accepts a new message, trims it, and defaults the language mode", () => {
    expect(parseChatRequest({ ...base, text: "  Hello  " })).toEqual({
      ok: true,
      value: { ...base, text: "Hello", languageMode: "realistic" },
    });
  });

  it("accepts a first message, a Retry, and the visitor language mode", () => {
    expect(parseChatRequest({ ...base, text: "Hi", first: true }).ok).toBe(true);
    expect(parseChatRequest({ ...base, retry: true, languageMode: "visitor" })).toEqual({
      ok: true,
      value: { ...base, retry: true, languageMode: "visitor" },
    });
  });

  it.each([
    ["no conversation id", { personaId: "wu", text: "hi" }],
    ["a conversation id that isn't a UUID", { ...base, conversationId: "abc", text: "hi" }],
    ["no persona", { conversationId: ID, text: "hi" }],
    ["no text and no retry", base],
    ["a blank message", { ...base, text: "   " }],
    ["a message over 4,000 characters", { ...base, text: "x".repeat(4001) }],
    ["text and retry together", { ...base, text: "hi", retry: true }],
    ["first and retry together", { ...base, retry: true, first: true }],
    // The server owns the history: an old client's fields are refused, not silently dropped.
    ["the old messages field", { ...base, text: "hi", messages: [{ role: "user", text: "hi" }] }],
    ["the old acts field", { ...base, text: "hi", acts: [] }],
    ["an unknown field", { ...base, text: "hi", kind: "arrival" }],
    ["a non-object", "hello"],
  ])("rejects %s", (_label, body) => {
    expect(parseChatRequest(body)).toMatchObject({ ok: false, error: expect.any(String) });
  });
});

describe("toAgentMessages", () => {
  it("maps persona to assistant and keeps only the last messages", () => {
    const messages = Array.from({ length: HISTORY_WINDOW + 2 }, (_, i) =>
      i % 2 === 0 ? { role: "user" as const, text: `u${i}` } : { role: "persona" as const, text: `p${i}` },
    );
    const mapped = toAgentMessages(messages);
    expect(mapped).toHaveLength(HISTORY_WINDOW);
    expect(mapped[0]).toEqual({ role: "user", content: "u2" });
    expect(mapped[1]).toEqual({ role: "assistant", content: "p3" });
  });
});
