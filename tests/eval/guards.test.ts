import { describe, expect, it } from "vitest";
import { applyGuards, dropOpener, stripMarkdown } from "../../eval/guards";

describe("stripMarkdown (spec §30.3)", () => {
  it("removes emphasis, headings, bullets and short numbered lines", () => {
    expect(stripMarkdown("I read **Annalen** and *Faust* and _Werther_.")).toBe("I read Annalen and Faust and Werther.");
    expect(stripMarkdown("# My youth\nUlm, then Munich.")).toBe("My youth\nUlm, then Munich.");
    expect(stripMarkdown("Things:\n- one\n• two\n1. three")).toBe("Things:\none\ntwo\nthree");
  });
  it("leaves ordinary text alone", () => {
    for (const text of ["It was 3 * 4, no more.", "a snake_case name", "1905. That year changed everything.", "Patent clerk, level III."]) {
      expect(stripMarkdown(text)).toBe(text);
    }
  });
  it("keeps a variable's letter: *c*, becomes c,", () => {
    expect(stripMarkdown("at exactly *c*, the speed")).toBe("at exactly c, the speed");
  });
});

describe("dropOpener (spec §30.3)", () => {
  it("drops a first sentence that announces a lookup or a pause", () => {
    expect(dropOpener("Let me gather my thoughts. A life is a large thing.")).toBe("A life is a large thing.");
    expect(dropOpener("Let me search my memory on this — it's a question I've faced.\n\nYou've put your finger on it.")).toBe("It's a question I've faced.\n\nYou've put your finger on it.");
  });
  it("keeps a reply that is nothing but the opener, so the answer is never empty", () => {
    expect(dropOpener("Let me search my memory.")).toBe("Let me search my memory.");
  });
  it("leaves a reply alone when the opener isn't in the first sentence", () => {
    const text = "I was born in Ulm. Let me tell you about Munich.";
    expect(dropOpener(text)).toBe(text);
  });
});

describe("applyGuards", () => {
  it("strips markdown first, so a bold opener is still dropped", () => {
    expect(applyGuards("**Let me check my notes.** I sailed in 1898.")).toBe("I sailed in 1898.");
  });
  it("drops only the opener's clause, never the facts after a colon or dash (final review #3)", () => {
    expect(dropOpener("Let me search my memory: I was born in Ulm in 1879. Then Munich.")).toBe("I was born in Ulm in 1879. Then Munich.");
    expect(dropOpener("Let me search my memory — yes, in 1905 I published four papers.")).toBe("Yes, in 1905 I published four papers.");
  });
  it("leaves an in-character 'let me look at you' alone", () => {
    const text = "Let me look at you, child. You remind me of my sister.";
    expect(dropOpener(text)).toBe(text);
  });
});
