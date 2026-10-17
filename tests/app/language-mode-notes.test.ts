import { describe, expect, it } from "vitest";
import type { Message } from "@/lib/chat-types";
import { languageModeNotes } from "@/lib/language-mode";

const user = (id: string, languageMode?: Message["languageMode"]): Message => ({ id, role: "user", text: id, ...(languageMode ? { languageMode } : {}) });
const reply = (id: string): Message => ({ id, role: "persona", text: id });

describe("languageModeNotes", () => {
  it("marks the first message sent after the switch changed, with on or off", () => {
    const messages = [user("a", "realistic"), reply("r1"), user("b", "visitor"), reply("r2"), user("c", "visitor"), user("d", "realistic")];
    expect(languageModeNotes(messages)).toEqual(new Map([
      ["b", "on"],
      ["d", "off"],
    ]));
  });

  it("starts from off, so a first message sent with it on gets a note", () => {
    expect(languageModeNotes([user("a", "visitor")])).toEqual(new Map([["a", "on"]]));
  });

  it("skips messages that don't record it (older ones, voice)", () => {
    expect(languageModeNotes([user("a", "visitor"), user("b"), user("c", "visitor"), user("d", "realistic")])).toEqual(new Map([
      ["a", "on"],
      ["d", "off"],
    ]));
  });
});
