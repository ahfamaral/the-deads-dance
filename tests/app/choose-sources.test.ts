import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import ChooseSources, { ExtraItem, languageGroups } from "@/components/choose-sources";
import ReingestConfirm from "@/components/reingest-confirm";
import RoundProgress, { progressLines } from "@/components/round-progress";
import type { SourcePlan } from "@corpus/plan-changes";
import type { SourceRef } from "@corpus/rounds";
import { describeChanges, removedArticleLanguage, type EditionDto, type SourceDto } from "@/lib/persona-profile";

// The planChanges fixtures of tests/corpus/reingest.test.ts.
const EN: SourceRef & { kind: "article"; site: "wikipedia" } = { kind: "article", site: "wikipedia", language: "en", title: "Chien-Shiung Wu" };
const PT: SourceRef & { kind: "article"; site: "wikipedia" } = { kind: "article", site: "wikipedia", language: "pt", title: "Wu Chien-Shiung" };
const QUOTES: SourceRef = { kind: "quotes", site: "wikiquote", language: "en", title: "Chien-Shiung Wu" };
const MENTION: SourceRef = { kind: "mention", site: "wikipedia", language: "pt", title: "Universidade de Columbia" };
const LINKED: SourceRef = { kind: "linked", site: "wikipedia", language: "pt", title: "Projeto Manhattan" };
const plan = (overrides: Partial<SourcePlan> = {}): SourcePlan => ({
  article: EN, extras: [], articleEstimated: 30, redraft: false, redraftEstimated: 50, ...overrides,
});
const extra = (ref: SourceRef, estimated = 5) => ({ ...ref, estimated });
const stored = (ref: SourceRef): SourceDto => ({ ...ref, revid: 1, url: "u", passages: 3 });

describe("describeChanges (spec §34.5)", () => {
  it("words planChanges: a replaced article, added extras, removed ones; kept ones are not changes", () => {
    const current = [stored(EN), stored(QUOTES), stored(MENTION)];
    expect(describeChanges(current, plan({ article: PT, extras: [extra(QUOTES), extra(LINKED)] }))).toEqual([
      { label: "English article → Portuguese", estimated: 30 },
      { label: "+ 1 linked article (Portuguese)", estimated: 5 },
      { label: "− 1 page mentioning them (Portuguese)", estimated: 0 },
    ]);
  });

  it("lists nothing when the article is kept, and counts a source ticked twice once", () => {
    expect(describeChanges([stored(EN)], plan())).toEqual([]);
    expect(describeChanges([], plan({ extras: [extra(QUOTES), extra(QUOTES)] }))).toEqual([
      { label: "+ English article", estimated: 30 },
      { label: "+ Real quotes (English)", estimated: 5 },
    ]);
  });

  it("joins extras of one kind and language on one line, summing their estimates", () => {
    const other = { ...LINKED, title: "Universidade de Columbia" };
    expect(describeChanges([stored(EN)], plan({ extras: [extra(LINKED, 4), extra(other, 6)] }))).toEqual([
      { label: "+ 2 linked articles (Portuguese)", estimated: 10 },
    ]);
  });

  it("names a same-language replacement by its title", () => {
    const renamed = { ...EN, title: "Wu Chien-Shiung (physicist)" };
    expect(describeChanges([stored(EN)], plan({ article: renamed }))).toEqual([
      { label: 'English article → "Wu Chien-Shiung (physicist)"', estimated: 30 },
    ]);
  });

  it("tells which language's article passages go", () => {
    expect(removedArticleLanguage([stored(EN)], plan({ article: PT }))).toBe("en");
    expect(removedArticleLanguage([stored(EN)], plan({ article: { ...EN, title: "Other" } }))).toBeNull();
    expect(removedArticleLanguage([], plan())).toBeNull();
  });
});

const EDITIONS: EditionDto[] = [
  { language: "en", title: "Chien-Shiung Wu", words: 8_200, badge: null, estimated: 3_000, redraftEstimated: 2_000 },
  { language: "pt", title: "Wu Chien-Shiung", words: 14_900, badge: "good", estimated: 4_000, redraftEstimated: 3_000 },
];
const SCORES = [
  { language: "pt", title: "Wu Chien-Shiung", words: 14_900, badge: "good" as const, answered: 26, total: 30 },
  { language: "en", title: "Chien-Shiung Wu", words: 8_200, badge: null, answered: 19, total: 30 },
];
const noop = () => {};
const base = {
  editions: EDITIONS,
  scores: SCORES,
  languages: ["pt"],
  current: [] as SourceDto[],
  candidatesUrl: () => "/x",
  compareEstimated: 3_000,
  comparing: false,
  compareError: null,
  onCompare: noop,
  redraft: false,
  onToggleRedraft: noop,
  onSubmit: noop,
};
const render = (props: Partial<Parameters<typeof ChooseSources>[0]> & { mode: "new" | "reingest" }) =>
  renderToStaticMarkup(createElement(ChooseSources, { ...base, ...props }));

/** The radio input for an edition, by its value. */
const radio = (html: string, language: string) => html.match(new RegExp(`<input[^>]*value="${language}"[^>]*>`))?.[0] ?? "";

describe("ChooseSources (spec §34.5)", () => {
  it("new: tags the top edition Most complete and selects it; the total is its estimate plus the profile", () => {
    const html = render({ mode: "new" });
    expect(html).toContain("Most complete");
    expect(html).toContain("Good article");
    expect(html).toContain("26 of 30");
    expect(radio(html, "pt")).toContain("checked");
    expect(radio(html, "en")).not.toContain("checked");
    expect(html).toContain("Character profile and highlights");
    // 4,000 to embed the Portuguese article + 3,000 to draft the profile.
    expect(html).toContain("about $0.007");
    expect(html).toContain("Add persona · $0.007");
    expect(html).toContain("Nothing is spent until you press Add persona.");
    expect(html).not.toContain("Review changes");
  });

  it("reingest: selects the article in use, priced as kept, ticks its extras and offers the redraft", () => {
    const html = render({ mode: "reingest", current: [stored(EN), stored(QUOTES)] });
    expect(html).toContain("In use now");
    expect(radio(html, "en")).toContain("checked");
    expect(html).toContain("kept");
    expect(html).toContain("Also redraft highlights and character from the new sources");
    expect(html).toContain("Review changes");
    expect(html).toContain("Nothing is spent until you press Reingest.");
    expect(html).not.toContain("Add persona");
    // Nothing new is ticked: the total is nothing.
    expect(html).toContain("about $0.00");
    // The stored quotes page is listed, ticked, under its language.
    expect(html).toMatch(/<input type="checkbox" aria-label="Real quotes"[^>]*checked=""[^>]*>.*?<input type="checkbox"[^>]*checked=""/);
  });

  it("reingest without a comparison offers to compare, priced", () => {
    const html = render({ mode: "reingest", scores: null, current: [stored(EN)] });
    expect(html).toContain("Compare editions · $0.003");
    expect(html).not.toContain("Most complete");
    expect(html).toContain("8,200 words");
  });

  it("groups each list by language, the main edition's first", () => {
    const mentionEn = { ...MENTION, language: "en", title: "Columbia University" };
    const page = render({ mode: "reingest", current: [stored(PT), stored(mentionEn), stored(MENTION)] });
    const html = page.slice(page.indexOf("Where others mention them"));
    const pt = html.indexOf(">Portuguese<");
    const en = html.indexOf(">English<");
    expect(pt).toBeGreaterThan(-1);
    expect(en).toBeGreaterThan(pt);
    expect(languageGroups("pt", ["fr", "pt"])).toEqual(["pt", "fr", "en"]);
    expect(languageGroups("en", ["pt"], ["de"])).toEqual(["en", "pt", "de"]);
  });

  it("has no dot-joined meta strings outside the buttons", () => {
    const html = render({ mode: "new" }).replace(/Add persona · \$[\d.]+/, "");
    expect(html).not.toContain("·");
  });
});

describe("ExtraItem (spec §34.5)", () => {
  it("quotes each paragraph a mention keeps", () => {
    const candidate = {
      ...MENTION, kind: "mention" as const, chars: 300, estimated: 120,
      preview: "Wu worked at Columbia from 1944.\n\nIn 1956 Wu showed parity violation at Columbia.",
    };
    const html = renderToStaticMarkup(createElement(ExtraItem, { candidate, checked: true, isNew: true, kept: false, disabled: false, onToggle: noop }));
    expect(html).toContain("Universidade de Columbia");
    expect(html).toContain("<q>Wu worked at Columbia from 1944.</q>");
    expect(html).toContain("<q>In 1956 Wu showed parity violation at Columbia.</q>");
    expect(html).toContain("new");
    expect(html).toContain("about $0.0001");
  });

  it("shows a quote page's count and a writing's size", () => {
    const quotes = renderToStaticMarkup(createElement(ExtraItem, {
      candidate: { ...QUOTES, kind: "quotes" as const, chars: 900, count: 22, estimated: 100 }, checked: false, isNew: false, kept: false, disabled: false, onToggle: noop,
    }));
    expect(quotes).toContain("22 quotes");
    const writing = renderToStaticMarkup(createElement(ExtraItem, {
      candidate: { kind: "writing" as const, site: "wikisource" as const, language: "fr", title: "Dans l'air", chars: 60_000, estimated: 4_000 },
      checked: false, isNew: false, kept: false, disabled: false, onToggle: noop,
    }));
    expect(writing).toContain("about 10,000 words");
  });
});

describe("ReingestConfirm (spec §34.5)", () => {
  const props = {
    changes: [{ label: "English article → Portuguese", estimated: 4_000 }, { label: "− Real quotes (English)", estimated: 0 }],
    total: 4_000,
    articleLanguageRemoved: "en",
    redraft: false,
    redraftEstimated: 2_000,
    onToggleRedraft: noop,
    onConfirm: noop,
    onBack: noop,
  };

  it("lists the changes, priced, and the removal note with the language's name", () => {
    const html = renderToStaticMarkup(createElement(ReingestConfirm, props));
    expect(html).toContain("English article → Portuguese");
    expect(html).toContain("about $0.004");
    expect(html).toContain("free");
    expect(html).toContain("English passages are removed. Past conversations keep their source chips. Testers keep the current memory until this finishes.");
    expect(html).toContain("Also redraft highlights and character from the new sources");
    expect(html).toContain("Reingest · $0.004");
    expect(html).toContain(">Back<");
  });

  it("has no removal note when no article language goes", () => {
    const html = renderToStaticMarkup(createElement(ReingestConfirm, { ...props, articleLanguageRemoved: null }));
    expect(html).not.toContain("passages are removed");
  });
});

describe("RoundProgress (spec §34.5, §34.8)", () => {
  it("waits on fetching the texts until the first event", () => {
    const html = renderToStaticMarkup(createElement(RoundProgress, { events: [] }));
    expect(html).toContain("Fetching texts…");
  });

  it("folds events into lines: one segment each, a redraft's new label replaces its start", () => {
    const events = [
      { type: "progress" as const, label: "Real quotes, 22", status: "finished" as const, spent: 0 },
      { type: "progress" as const, label: "Fetching texts", status: "started" as const, spent: 0 },
      { type: "progress" as const, label: "Fetching texts", status: "finished" as const, spent: 0 },
      { type: "progress" as const, label: "Portuguese article, 212 passages (replaced English)", status: "started" as const, spent: 0 },
      { type: "progress" as const, label: "Portuguese article, 212 passages (replaced English)", status: "finished" as const, spent: 4_000 },
      { type: "progress" as const, label: "Mentions: Fluminense had nothing to add", status: "skipped" as const, spent: 4_000 },
      { type: "progress" as const, label: "Highlights and character", status: "started" as const, spent: 4_000 },
    ];
    expect(progressLines(events).map((l) => [l.label, l.state])).toEqual([
      ["Real quotes, 22", "done"],
      ["Fetching texts", "done"],
      ["Portuguese article, 212 passages (replaced English)", "done"],
      ["Mentions: Fluminense had nothing to add", "skipped"],
      ["Highlights and character", "running"],
    ]);
    const finished = [...events, { type: "progress" as const, label: "Highlights and character redrafted", status: "finished" as const, spent: 6_000 }];
    expect(progressLines(finished).at(-1)).toEqual({ label: "Highlights and character redrafted", state: "done" });

    const html = renderToStaticMarkup(createElement(RoundProgress, { events }));
    expect(html).toContain("Spent so far $0.004");
    expect(html.match(/data-segment=/g)).toHaveLength(6); // five lines and one still to come
  });

  it("shows a failure's message", () => {
    const html = renderToStaticMarkup(createElement(RoundProgress, { events: [{ type: "error", message: "A round is already running for this persona.", code: "round_running" }] }));
    expect(html).toContain('role="alert"');
    expect(html).toContain("A round is already running for this persona.");
  });
});
