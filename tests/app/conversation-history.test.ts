import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { HistoryRowHead } from "@/components/conversation-history";
import type { ConversationSummary } from "@/lib/conversation-types";

const summary = (voiceLanguage: string | null): ConversationSummary => ({
  id: "c1",
  personaId: "wu",
  personaName: "Chien-Shiung Wu",
  preview: "Hi",
  updatedAt: "2026-09-23T10:00:00.000Z",
  ended: null,
  stars: null,
  voiceLanguage,
});

describe("a History row (spec §33.6)", () => {
  it("shows the voice icon after the persona's name for a voice conversation", () => {
    const out = renderToStaticMarkup(createElement(HistoryRowHead, { conversation: summary("de") }));
    expect(out).toContain('aria-label="Voice conversation"');
    expect(out.indexOf("Chien-Shiung Wu")).toBeLessThan(out.indexOf("Voice conversation"));
  });
  it("shows no icon for a text conversation", () => {
    expect(renderToStaticMarkup(createElement(HistoryRowHead, { conversation: summary(null) }))).not.toContain("Voice conversation");
  });
});
