import { describe, expect, it } from "vitest";
import { applyGuards, createStreamGuard, dropOpener, stripMarkdown } from "@/lib/server/reply-guards";

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

/** Streams `chunks` through a guard: what the visitor saw, what finish added, and the finished text. */
function stream(chunks: string[]) {
  const guard = createStreamGuard();
  const shown = chunks.map((c) => guard.push(c)).join("");
  const final = applyGuards(chunks.join(""));
  return { shown, rest: guard.finish(final), final };
}
const SAMPLES = [
  "Let me search my memory. I was born in Ulm in 1879.",
  "Let me check.\n\nI was born in Ulm, in Württemberg.",
  "**Ulm**, in 1879. My father ran an *electrical* business.",
  "## My youth\n- Munich\n- Milan\n1. Zurich",
  "Three * four is twelve, and snake_case stays. At *c*, light is fixed.",
  "Let me search my memory.",
  "I was born in Ulm. Let me check the year: 1879.",
  "Gather my thoughts? No. Ask plainly.",
  "1. Let me check. Ulm.\n2. Munich, then *Milan*.",
  "At *c*, light is fixed, and 3 * 4 is twelve.\nA new line with _care_ and snake_case.",
];

describe("createStreamGuard (spec §30.7)", () => {
  it("streams exactly the guarded text, however the reply is split", () => {
    for (const text of SAMPLES) {
      for (const size of [1, 2, 3, 5, 8, 13]) {
        const chunks = text.match(new RegExp(`[\\s\\S]{1,${size}}`, "g"))!;
        const { shown, rest, final } = stream(chunks);
        expect(final.startsWith(shown), `${JSON.stringify(text)} in chunks of ${size}: showed ${JSON.stringify(shown)}`).toBe(true);
        expect(shown + rest).toBe(final);
      }
    }
  });
  it("never shows an opener, even split mid-word", () => {
    const { shown } = stream(["Let me se", "arch my mem", "ory. I was born", " in Ulm in 1879."]);
    expect(shown).not.toMatch(/search/i);
    expect(shown.startsWith("I was born")).toBe(true);
  });
  it("never shows a markdown mark split across chunks", () => {
    const { shown } = stream(["I was born in *", "*Ulm*", "* in 1879.\n", "#", "# Youth\n-", " Munich and more."]);
    expect(shown).not.toMatch(/[*#]|^- /m);
  });
  it("holds the first sentence until it ends, then lets the rest flow", () => {
    const guard = createStreamGuard();
    expect(guard.push("I was born in Ulm")).toBe("");
    expect(guard.push(". My father")).toBe("I was born in Ulm. My father");
  });
  it("releases a long first sentence without punctuation after 300 characters", () => {
    const guard = createStreamGuard();
    expect(guard.push("a ".repeat(160)).length).toBeGreaterThan(0);
  });
  it("shows a reply that is only an opener at the end, never an empty answer", () => {
    const { shown, rest, final } = stream(["Let me search ", "my memory."]);
    expect(final).toBe("Let me search my memory.");
    expect(shown + rest).toBe(final);
  });
});

describe("final review fixes (spec §30.7)", () => {
  it("never shows an opener ending in an ellipsis or ?!, split one character at a time", () => {
    for (const opener of ["Let me search my memory...", "Let me check?!", 'Let me check." ']) {
      const text = `${opener}\n\nI was born in Ulm. Yes.`;
      const { shown, rest, final } = stream([...text]);
      expect(final).toBe("I was born in Ulm. Yes.");
      expect(shown + rest).toBe(final);
    }
  });
  it("takes the ellipsis … for a clause end, so no fact after it is dropped", () => {
    expect(applyGuards("Let me search my memory… I was born in Ulm in 1879. My father sold beds.")).toBe("I was born in Ulm in 1879. My father sold beds.");
    const { shown, rest, final } = stream([..."Let me search my memory… I was born in Ulm."]);
    expect(final).toBe("I was born in Ulm.");
    expect(shown + rest).toBe(final);
  });
});
