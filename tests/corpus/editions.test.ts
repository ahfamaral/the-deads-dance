import { describe, expect, it, vi } from "vitest";
import type { BaseChatModel } from "@langchain/core/language_models/chat_models";
import { compareEditions, countWords, editionScorerWith, listEditions, VISITOR_QUESTIONS, type Edition } from "../../corpus/editions";
import type { Sitelink, WikimediaClient } from "../../corpus/wikimedia";

function fakeClient(links: Sitelink[]): WikimediaClient {
  return {
    sitelinks: async () => links,
    extract: vi.fn(async (_ref, title: string) => ({ title, revid: 7, qid: "Q1", text: `one two three ${title}` })),
  } as unknown as WikimediaClient;
}
const link = (language: string, badges: Sitelink["badges"] = []): Sitelink => ({ site: "wikipedia", language, title: `T-${language}`, badges });
const edition = (language: string, badge: Edition["badge"], words: number): Edition => ({ language, title: language, words, chars: 1, badge, revid: 1, text: language });

describe("VISITOR_QUESTIONS", () => {
  it("has 30 unique questions", () => {
    expect(VISITOR_QUESTIONS).toHaveLength(30);
    expect(new Set(VISITOR_QUESTIONS).size).toBe(30);
  });
});

describe("listEditions", () => {
  const all = ["en", "pt", "fr", "es", "de"].map((l) => link(l, l === "pt" ? ["featured"] : []));
  it("lists English first, then the languages in order", async () => {
    const out = await listEditions(fakeClient(all), "Q1", ["pt", "fr"]);
    expect(out.map((e) => e.language)).toEqual(["en", "pt", "fr"]);
    expect(out[1]).toMatchObject({ badge: "featured", words: 4, chars: "one two three T-pt".length, revid: 7 });
  });
  it("takes at most four, without repeats", async () => {
    const out = await listEditions(fakeClient(all), "Q1", ["en", "pt", "fr", "es", "de"]);
    expect(out.map((e) => e.language)).toEqual(["en", "pt", "fr", "es"]);
  });
  it("skips a language with no article", async () => {
    const out = await listEditions(fakeClient([link("en"), link("fr")]), "Q1", ["pt", "fr"]);
    expect(out.map((e) => e.language)).toEqual(["en", "fr"]);
  });
  it("ignores other Wikimedia sites", async () => {
    const quote: Sitelink = { ...link("pt"), site: "wikiquote" };
    expect((await listEditions(fakeClient([link("en"), quote]), "Q1", ["pt"])).map((e) => e.language)).toEqual(["en"]);
  });
});

describe("countWords", () => {
  it("counts whitespace-separated words", () => expect(countWords("  a b\n c ")).toBe(3));
});

describe("compareEditions", () => {
  it("counts distinct in-range answers", async () => {
    const [s] = await compareEditions([edition("en", null, 10)], async () => [0, 1, 1, 40, -1]);
    expect(s).toMatchObject({ answered: 2, total: 30 });
  });
  it("sorts by answered, then badge, then words", async () => {
    const answers: Record<string, number[]> = { en: [0], pt: [0], fr: [0], es: [0, 1] };
    const out = await compareEditions(
      [edition("en", null, 100), edition("pt", "good", 5), edition("fr", null, 200), edition("es", null, 1)],
      async (t) => answers[t],
    );
    expect(out.map((s) => s.language)).toEqual(["es", "pt", "fr", "en"]);
  });
});

describe("editionScorerWith", () => {
  it("sends the numbered questions and the article, and returns the answered indices", async () => {
    const invoke = vi.fn(async () => ({ answered: [2, 5] }));
    const model = { withStructuredOutput: () => ({ invoke }) } as unknown as BaseChatModel;
    expect(await editionScorerWith(model)("Some <b>text</b>")).toEqual([2, 5]);
    const messages = (invoke.mock.calls[0] as unknown as [{ content: string }[]])[0];
    expect(messages[0].content).toContain(`29. ${VISITOR_QUESTIONS[29]}`);
    expect(messages[1].content).toContain("Some btext/b");
  });
});
