import { describe, expect, it } from "vitest";
import { canRestoreLive, parseOpenChat, serializeOpenChat } from "@/lib/open-chat";

describe("the open-chat entry (spec §25.5)", () => {
  it("round-trips", () => {
    const c = { conversationId: "8f14e45f-ceea-467f-a0e6-2b8a2a6b1c11", personaId: "wu" };
    expect(parseOpenChat(serializeOpenChat(c))).toEqual(c);
  });

  it.each([null, "", "not json", "[]", "{}", '{"conversationId":"x"}', '{"conversationId":"","personaId":"wu"}', '{"conversationId":1,"personaId":"wu"}'])(
    "reads %j as nothing",
    (raw) => {
      expect(parseOpenChat(raw)).toBeNull();
    },
  );
});

describe("restoring the open chat (spec §27)", () => {
  const conv = (userEmail?: string) => ({ id: "c", personaId: "wu", personaName: "Wu", updatedAt: "", messages: [], ...(userEmail ? { userEmail } : {}) });
  it("reopens your own conversation live", () => {
    expect(canRestoreLive(conv(), "ana@example.com")).toBe(true); // a tester's read carries no userEmail
    expect(canRestoreLive(conv("boss@example.com"), "boss@example.com")).toBe(true);
  });
  it("never reopens another user's conversation live, e.g. after switching accounts in the tab", () => {
    expect(canRestoreLive(conv("ana@example.com"), "boss@example.com")).toBe(false);
  });
});
