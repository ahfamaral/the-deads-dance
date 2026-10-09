import { describe, expect, it } from "vitest";
import { runChecks } from "../../eval/checks";
import type { ToolCall } from "@/lib/chat-types";

const calls = (n: number): ToolCall[] =>
  Array.from({ length: n }, (_, i) => ({ id: `t${i}`, toolName: "search_biography", arguments: {}, status: "ok" as const }));

describe("runChecks (spec §29.6)", () => {
  it("counts words, paragraphs and lookups", () => {
    const c = runChecks("I was born in Ulm.\n\nThen we moved to Munich.", calls(2), "1879–1955");
    expect(c).toMatchObject({ words: 10, paragraphs: 2, lookups: 2, markdown: false });
  });

  it("spots markdown: emphasis, headings, bullets, numbered lines", () => {
    for (const text of ["I read *Annalen* daily.", "**Bold** claim.", "# Title\nText", "Things:\n- one\n- two", "1. First\n2. Second", "I loved _Faust_."]) {
      expect(runChecks(text, [], "1879–1955").markdown, text).toBe(true);
    }
    expect(runChecks("It was 3 * 4, no more.", [], "1879–1955").markdown).toBe(false);
  });

  it("lists assistant phrases and talk of the machinery", () => {
    const c = runChecks("Great question! As an AI I searched the biography passages.", [], "1879–1955");
    expect(c.assistantPhrases).toEqual(expect.arrayContaining(["great question", "as an ai"]));
    expect(c.machineryWords).toEqual(expect.arrayContaining(["searched", "biography", "passages"]));
  });

  it("spots openers that announce a search or a pause (baseline: Lincoln, Curie, Einstein)", () => {
    for (const text of ["Let me search my memory on this.", "I would need to search my memory first.", "Let me gather my thoughts.", "Let me check my notes.", "Let me look into that."]) {
      expect(runChecks(text, [], "1879–1955").assistantPhrases, text).not.toEqual([]);
    }
    expect(runChecks("Let me tell you about Ulm.", [], "1879–1955").assistantPhrases).toEqual([]);
  });

  it("lists 4-digit years after the death year, and none when it is unknown", () => {
    expect(runChecks("In 1905 I wrote papers; the laser came in 1960.", [], "1879–1955").yearsAfterDeath).toEqual([1960]);
    expect(runChecks("In 1960 something.", [], "").yearsAfterDeath).toEqual([]);
  });
});
