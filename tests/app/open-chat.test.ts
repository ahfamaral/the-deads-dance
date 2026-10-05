import { describe, expect, it } from "vitest";
import { parseOpenChat, serializeOpenChat } from "@/lib/open-chat";

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
