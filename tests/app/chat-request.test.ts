import { describe, expect, it } from "vitest";
import { HISTORY_WINDOW, parseChatRequest, toAgentMessages } from "@/lib/server/chat-request";

const user = (text: string) => ({ role: "user" as const, text });
const persona = (text: string) => ({ role: "persona" as const, text });

describe("parseChatRequest", () => {
  it("accepts a valid request and trims text", () => {
    expect(parseChatRequest({ personaId: "wu", messages: [user("  Hello  ")] })).toEqual({
      ok: true,
      value: { personaId: "wu", messages: [user("Hello")], acts: [], languageMode: "realistic" },
    });
  });

  // F2: the 4,000-char cap is for the user's own words; a persona message (one of its own
  // earlier replies) gets a much more generous cap instead.
  it("accepts a persona message over 4,000 characters", () => {
    const long = persona("x".repeat(6000));
    expect(parseChatRequest({ personaId: "wu", messages: [long, user("hi")] })).toEqual({
      ok: true,
      value: { personaId: "wu", messages: [long, user("hi")], acts: [], languageMode: "realistic" },
    });
  });

  it.each([
    ["no persona", { messages: [user("hi")] }],
    ["no messages", { personaId: "wu", messages: [] }],
    ["51 messages", { personaId: "wu", messages: Array.from({ length: 51 }, () => user("hi")) }],
    ["a blank message", { personaId: "wu", messages: [user("   ")] }],
    ["a message over 4,000 characters", { personaId: "wu", messages: [user("x".repeat(4001))] }],
    // F2: a persona message still has a bound, just a much larger one.
    ["a persona message over 20,000 characters", { personaId: "wu", messages: [persona("x".repeat(20001)), user("hi")] }],
    ["an unknown role", { personaId: "wu", messages: [{ role: "system", text: "hi" }] }],
    ["a persona message last", { personaId: "wu", messages: [user("hi"), { role: "persona", text: "hello" }] }],
    ["a non-object", "hello"],
  ])("rejects %s", (_label, body) => {
    expect(parseChatRequest(body)).toMatchObject({ ok: false, error: expect.any(String) });
  });
});

describe("toAgentMessages", () => {
  it("maps persona to assistant and keeps only the last messages", () => {
    const messages = Array.from({ length: HISTORY_WINDOW + 2 }, (_, i) =>
      i % 2 === 0 ? user(`u${i}`) : { role: "persona" as const, text: `p${i}` },
    );
    const mapped = toAgentMessages(messages);
    expect(mapped).toHaveLength(HISTORY_WINDOW);
    expect(mapped[0]).toEqual({ role: "user", content: "u2" });
    expect(mapped[1]).toEqual({ role: "assistant", content: "p3" });
  });
});

describe("parseChatRequest: behaviour fields (spec §18.7)", () => {
  const act = { act: "question", offense: 0, sorePoint: false, language: "en", wants: "normal", visitorName: null };
  const turn = { personaId: "wu", messages: [{ role: "user", text: "Hi" }] };

  it("defaults acts and languageMode for an old client", () => {
    const parsed = parseChatRequest(turn);
    expect(parsed).toEqual({ ok: true, value: { ...turn, acts: [], languageMode: "realistic" } });
  });

  it("accepts acts with nulls, and the visitor language mode", () => {
    const parsed = parseChatRequest({ ...turn, acts: [act, null], languageMode: "visitor" });
    expect(parsed.ok && parsed.value.acts).toEqual([act, null]);
  });

  // Review Focus 4: a tampered act is a 400, not a crash.
  it.each([
    ["an unknown act", { ...act, act: "shout" }],
    ["an out-of-range offense", { ...act, offense: 7 }],
    ["an extra field", { ...act, mood: "grumpy" }],
    ["a long name", { ...act, visitorName: "x".repeat(41) }],
  ])("rejects %s", (_label, bad) => {
    expect(parseChatRequest({ ...turn, acts: [bad] }).ok).toBe(false);
  });

  it("caps acts at 500", () => {
    expect(parseChatRequest({ ...turn, acts: Array.from({ length: 501 }, () => null) }).ok).toBe(false);
  });

  // Spec §18.5 (revised 2026-09-29): the visitor always speaks first; there is no arrival turn.
  it("refuses an empty arrival: the visitor speaks first", () => {
    expect(parseChatRequest({ personaId: "wu", kind: "arrival", messages: [] })).toEqual({
      ok: false,
      error: "Send at least one message.",
    });
    const stale = parseChatRequest({ ...turn, kind: "arrival" }); // an old client's field is ignored
    expect(stale.ok && "kind" in stale.value).toBe(false);
  });

  it("still requires a turn to end with the user's message", () => {
    expect(parseChatRequest({ personaId: "wu", messages: [] })).toEqual({ ok: false, error: "Send at least one message." });
    expect(parseChatRequest({ personaId: "wu", messages: [{ role: "persona", text: "Hello." }] })).toEqual({
      ok: false,
      error: "The last message must be the user's.",
    });
  });
});
