import { describe, expect, it } from "vitest";
import { canRestoreLive, linkedConversation, parseOpenChat, serializeOpenChat } from "@/lib/open-chat";

describe("the open-chat entry (spec §25.5)", () => {
  it("round-trips", () => {
    const c = { conversationId: "8f14e45f-ceea-467f-a0e6-2b8a2a6b1c11", personaId: "wu" };
    expect(parseOpenChat(serializeOpenChat(c))).toEqual(c);
  });

  it("keeps a voice language through the round trip", () => {
    const c = { conversationId: "a", personaId: "b", voiceLanguage: "de" };
    expect(parseOpenChat(serializeOpenChat(c))).toEqual(c);
    expect(parseOpenChat('{"conversationId":"a","personaId":"b","voiceLanguage":"de"}')?.voiceLanguage).toBe("de");
  });

  it.each([5, "", "d", "german", null])("drops a bad voiceLanguage %j", (bad) => {
    const parsed = parseOpenChat(JSON.stringify({ conversationId: "a", personaId: "b", voiceLanguage: bad }));
    expect(parsed).toEqual({ conversationId: "a", personaId: "b" });
  });

  it.each([null, "", "not json", "[]", "{}", '{"conversationId":"x"}', '{"conversationId":"","personaId":"wu"}', '{"conversationId":1,"personaId":"wu"}'])(
    "reads %j as nothing",
    (raw) => {
      expect(parseOpenChat(raw)).toBeNull();
    },
  );
});

describe("restoring the open chat (spec §27)", () => {
  const conv = (userEmail?: string) => ({ id: "c", personaId: "wu", personaName: "Wu", updatedAt: "", messages: [], mode: "text" as const, voiceLanguage: null, ...(userEmail ? { userEmail } : {}) });
  it("reopens your own conversation live", () => {
    expect(canRestoreLive(conv(), "ana@example.com")).toBe(true); // a tester's read carries no userEmail
    expect(canRestoreLive(conv("boss@example.com"), "boss@example.com")).toBe(true);
  });
  it("never reopens another user's conversation live, e.g. after switching accounts in the tab", () => {
    expect(canRestoreLive(conv("ana@example.com"), "boss@example.com")).toBe(false);
  });
});

describe("linkedConversation (spec §32.7)", () => {
  const id = "8f14e45f-ceea-467f-a0e6-2b8a2a6b1c11";
  it("reads the conversation id from ?open=", () => {
    expect(linkedConversation(`?open=${id}`)).toBe(id);
    expect(linkedConversation(`?x=1&open=${id}`)).toBe(id);
  });
  it("ignores a missing or malformed id", () => {
    expect(linkedConversation("")).toBeNull();
    expect(linkedConversation("?open=")).toBeNull();
    expect(linkedConversation("?open=../admin")).toBeNull();
  });
});
