import { describe, expect, it } from "vitest";
import type { Message } from "@/lib/chat-types";
import { toMarkdown } from "@/lib/conversation-export";
import type { StoredConversation } from "@/lib/conversation-types";
import { ENDED_NOTE, STOPPED_NOTE } from "@/lib/message-notes";

const conversation = (messages: Message[]): StoredConversation => ({
  mode: "text",
  voiceLanguage: null,
  id: "c1",
  personaId: "chien-shiung-wu",
  personaName: "Chien-Shiung Wu",
  updatedAt: "2026-09-23T10:00:00.000Z",
  messages,
});

describe("toMarkdown", () => {
  it("writes both speakers and their text", () => {
    const md = toMarkdown(
      conversation([
        { id: "m1", role: "user", text: "Hello" },
        { id: "m2", role: "persona", text: "Good day." },
      ]),
    );
    expect(md).toContain("**You:** Hello");
    expect(md).toContain("**Chien-Shiung Wu:** Good day.");
    expect(md).not.toContain(STOPPED_NOTE);
    expect(md).not.toContain(ENDED_NOTE);
  });

  it("marks a stopped reply and the end of the visit, stop first", () => {
    const md = toMarkdown(
      conversation([
        { id: "m1", role: "user", text: "Goodbye." },
        { id: "m2", role: "persona", text: "Fare", stopped: true, ended: "farewell" },
      ]),
    );
    expect(md).toContain(`**Chien-Shiung Wu:** Fare\n\n*(${STOPPED_NOTE})*\n\n*(${ENDED_NOTE})*`);
  });
});
