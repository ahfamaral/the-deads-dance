import type { BaseChatModel } from "@langchain/core/language_models/chat_models";
import { describe, expect, it, vi } from "vitest";
import { checkHighlights, highlightsDrafterWith } from "../../corpus/highlights";
import { PROFILE_INPUT_CHARS } from "../../corpus/profile";

describe("checkHighlights", () => {
  it("keeps the first two non-empty paragraphs", () => {
    expect(checkHighlights("  One.\n\n\n\nTwo.\n\nThree.  ")).toBe("One.\n\nTwo.");
  });
  it("cuts a long paragraph under 1,200 characters at a full stop", () => {
    const out = checkHighlights("Born in Rio. ".repeat(160));
    expect(out.length).toBeLessThan(1200);
    expect(out.endsWith("Born in Rio.")).toBe(true);
  });
  it("returns an empty string for blank text", () => expect(checkHighlights(" \n\n ")).toBe(""));
});

describe("highlightsDrafterWith", () => {
  it("sends the capped text without angle brackets and returns checked output", async () => {
    const invoke = vi.fn(async () => ({ content: "A.\n\nB.\n\nC." }));
    const draft = highlightsDrafterWith({ invoke } as unknown as BaseChatModel);
    const out = await draft(`<b>x</b>${"y".repeat(PROFILE_INPUT_CHARS + 50)}`);
    expect(out).toBe("A.\n\nB.");
    const messages = (invoke.mock.calls[0] as unknown as [{ content: string }[]])[0];
    expect(messages[1].content).not.toContain("<b>");
    expect(messages[1].content.length).toBe(`<article>\n\n</article>`.length + PROFILE_INPUT_CHARS);
  });
});
