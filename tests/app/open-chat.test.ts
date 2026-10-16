import { afterEach, describe, expect, it, vi } from "vitest";
import {
  canRestoreLive,
  linkedConversation,
  OPEN_CHAT_KEY,
  parseOpenChat,
  readHeardReply,
  serializeOpenChat,
  unheardReply,
  writeHeardReply,
  writeOpenChat,
} from "@/lib/open-chat";

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

/** An in-memory sessionStorage. */
function fakeStorage(initial: Record<string, string> = {}) {
  const items = new Map(Object.entries(initial));
  return {
    items,
    getItem: (k: string) => items.get(k) ?? null,
    setItem: (k: string, v: string) => void items.set(k, v),
    removeItem: (k: string) => void items.delete(k),
  };
}

describe("the heard reply (spec §33.5 restore)", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("remembers the last reply heard in this conversation", () => {
    vi.stubGlobal("sessionStorage", fakeStorage());
    expect(readHeardReply("c1")).toBeNull();
    writeHeardReply("c1", 4);
    expect(readHeardReply("c1")).toBe(4);
    expect(readHeardReply("c2")).toBeNull(); // another conversation's
  });

  it("is forgotten with the open chat, and never touches the conversations key", () => {
    const storage = fakeStorage({ "persona-chatbot:conversations": "[1]" });
    vi.stubGlobal("sessionStorage", storage);
    writeOpenChat({ conversationId: "c1", personaId: "p" });
    writeHeardReply("c1", 2);
    writeOpenChat(null);
    expect(readHeardReply("c1")).toBeNull();
    expect(storage.items.get(OPEN_CHAT_KEY)).toBeUndefined();
    expect(storage.items.get("persona-chatbot:conversations")).toBe("[1]");
  });

  it("reads bad entries as nothing, and survives storage that throws", () => {
    vi.stubGlobal("sessionStorage", fakeStorage({ "deads-dance:heard-reply": "not json" }));
    expect(readHeardReply("c1")).toBeNull();
    vi.stubGlobal("sessionStorage", fakeStorage({ "deads-dance:heard-reply": '{"conversationId":"c1","length":"2"}' }));
    expect(readHeardReply("c1")).toBeNull();
    const throwing = { getItem: () => { throw new Error("blocked"); }, setItem: () => { throw new Error("blocked"); }, removeItem: () => { throw new Error("blocked"); } };
    vi.stubGlobal("sessionStorage", throwing);
    expect(readHeardReply("c1")).toBeNull();
    expect(() => writeHeardReply("c1", 2)).not.toThrow();
  });

  it("unheardReply: the last persona message, unless it is the one heard (by position)", () => {
    const user = { id: "u1", role: "user" as const, text: "Hallo?" };
    const reply = { id: "41", role: "persona" as const, text: "Guten Tag." };
    expect(unheardReply([user, reply], null)).toEqual(reply);
    expect(unheardReply([user, reply, user, reply], 2)).toEqual(reply); // an earlier reply was heard
    expect(unheardReply([user, reply], 2)).toBeNull();
    expect(unheardReply([user, reply, user], 2)).toBeNull();
    expect(unheardReply([], null)).toBeNull();
  });
});
