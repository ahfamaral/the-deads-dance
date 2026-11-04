import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import PersonaMessage from "@/components/persona-message";
import type { Message } from "@/lib/chat-types";
import { needsTranslation, SourcePassageView } from "@/components/source-passage";
import { ENDED_NOTE, STOPPED_NOTE } from "@/lib/message-notes";

const html = (message: Message) => renderToStaticMarkup(createElement(PersonaMessage, { personaName: "Wu", message }));
const reply = (extra: Partial<Message> = {}): Message => ({ id: "m", role: "persona", text: "In 1956 I", ...extra });

describe("PersonaMessage", () => {
  it("marks a reply cut short by Stop", () => {
    expect(html(reply({ stopped: true }))).toContain(STOPPED_NOTE);
  });

  it("shows no stop note on a finished reply", () => {
    expect(html(reply())).not.toContain(STOPPED_NOTE);
  });

  it("puts the stop note before the ending note when both apply", () => {
    const out = html(reply({ stopped: true, ended: "farewell" }));
    expect(out.indexOf(STOPPED_NOTE)).toBeGreaterThan(-1);
    expect(out.indexOf(STOPPED_NOTE)).toBeLessThan(out.indexOf(ENDED_NOTE));
  });

  it("shows the admin the reply's cost line, after the notes", () => {
    const out = renderToStaticMarkup(createElement(PersonaMessage, { personaName: "Wu", message: reply({ ended: "farewell", cost: 9_000, tokens: 1_800 }), showCost: true }));
    expect(out).toContain("1.8k tok · $0.009");
    expect(out.indexOf(ENDED_NOTE)).toBeLessThan(out.indexOf("1.8k tok"));
  });

  it("never shows a cost line without showCost", () => {
    expect(html(reply({ cost: 9_000, tokens: 1_800 }))).not.toContain("tok");
  });

  describe("a source chip's passage (spec §34.6)", () => {
    const passage = { chunk_id: 7, section_heading: "Infância", content: "Nasceu no Rio.", language: "pt" };
    const view = (translation: Parameters<typeof SourcePassageView>[0]["translation"]) =>
      renderToStaticMarkup(createElement(SourcePassageView, { passage, translation }));

    it("asks for a translation only when the languages differ, English being the default", () => {
      expect(needsTranslation("pt", "en")).toBe(true);
      expect(needsTranslation(undefined, "pt")).toBe(true);
      expect(needsTranslation("pt", "pt")).toBe(false);
      expect(needsTranslation(undefined, "en")).toBe(false);
      expect(needsTranslation("pt", null)).toBe(false);
    });

    it("shows the translation marked with the source language", () => {
      const out = view({ status: "done", heading: "Childhood", content: "Born in Rio." });
      expect(out).toContain("Born in Rio.");
      expect(out).toContain("Translated from Portuguese");
      expect(out).not.toContain("Nasceu no Rio.");
    });

    it("shows the original dimmed while loading, and plain when idle or failed", () => {
      expect(view({ status: "loading" })).toContain("opacity-50");
      for (const status of ["idle", "failed"] as const) {
        const out = view({ status });
        expect(out).toContain("Nasceu no Rio.");
        expect(out).not.toContain("opacity-50");
        expect(out).not.toContain("Translated from");
      }
    });
  });
});
