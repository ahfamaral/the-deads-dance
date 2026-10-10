import { describe, expect, it } from "vitest";
import { renderReport, summarize, weighted } from "../../eval/report";
import type { RunResults, ScoredAnswer } from "../../eval/types";

const rule = (pass: boolean) => ({ reason: "why", pass });
const scored = (over: Partial<ScoredAnswer>): ScoredAnswer => ({
  questionId: "q", setupId: "v1", persona: "albert-einstein", category: "ordinary", text: "Text.", error: null, truncated: false,
  toolCalls: [], lookups: "replay", durationMs: 1_000, answerMicros: 2_000, inputTokens: 1, outputTokens: 1,
  checks: { words: 100, paragraphs: 2, markdown: false, lookups: 1, assistantPhrases: [], machineryWords: [], yearsAfterDeath: [] },
  judge: { claims: [], relevancy: { reason: "r", score: 4 }, passages: [],
    rules: { after_death: rule(true), before_birth: rule(true), suicide: null, wrong_denial: rule(true), false_yes: rule(true), in_character: rule(true), as_expected: rule(true) } },
  judgeError: null, pairError: null, faithfulness: 1, contextPrecision: null, retrieval: { recallAt3: true, reciprocalRank: 1 }, pair: null, judgeMicros: 1_000, ...over,
});
const results: RunResults = {
  name: "screening-v1", startedAt: "2026-10-08T12:00:00Z", setups: ["v1"], baseline: "v0", questions: ["a", "b", "c"],
  estimateMicros: 10_000, actualMicros: 9_000, stoppedReason: null,
  models: { judge: "deepseek/deepseek-v4.1-flash", agent: { v1: "deepseek/deepseek-v4-pro" } },
  answers: [
    scored({ questionId: "a", truncated: true, inputTokens: 300, outputTokens: 100, pair: { reason: "r", winner: "A", order: "candidate-first" } }),
    scored({ questionId: "b", category: "broad", checks: { words: 600, paragraphs: 6, markdown: true, lookups: 2, assistantPhrases: [], machineryWords: [], yearsAfterDeath: [1960] },
      judge: { ...scored({}).judge!, rules: { ...scored({}).judge!.rules, after_death: rule(false) } }, faithfulness: 0.5,
      pair: { reason: "r", winner: "B", order: "baseline-first" } }),
    scored({ questionId: "c", text: null, error: "down", checks: null, judge: null, faithfulness: null }),
  ],
};

describe("summarize (spec §29.7)", () => {
  it("averages only scored answers, and counts errors apart", () => {
    const [s] = summarize(results);
    expect(s).toMatchObject({ setupId: "v1", answers: 3, errors: 1, scored: 2, faithfulness: 0.75, overTwoParagraphs: 1, markdown: 1 });
    expect(s.rules.after_death).toBe(0.5);
    expect(s.rules.suicide).toBeNull();
    expect(s.pairs).toEqual({ wins: 1, ties: 0, losses: 1, baselineFirstWins: 0, candidateFirstWins: 1 });
  });
});

describe("renderReport", () => {
  const md = renderReport(results, { random: () => 0, leftMicros: 6_000_000 });
  it("has the header, summary, per-category, rankings, worst answers, spot-check and caveats", () => {
    for (const heading of ["# Evaluation run: screening-v1", "## Summary", "## Per category", "## Rankings", "## Worst answers", "## Spot-check", "## Caveats"]) {
      expect(md).toContain(heading);
    }
    expect(md).toMatch(/Estimated \$0\.01, actual \$0\.009/);
    expect(md).toMatch(/\$6\.00 left of \$7\.00/);
    expect(md).toContain("[ ] agree [ ] disagree");
    expect(md).toContain("after_death: why");
  });
  it("shows notes apart from a stop, so a merged run doesn't read as stopped early", () => {
    const noted = renderReport({ ...results, notes: ["8 answers re-run in visitor mode"] }, { random: () => 0 });
    expect(noted).toContain("**Note:** 8 answers re-run in visitor mode.");
    expect(noted).not.toContain("Stopped early");
  });
  it("shows each setup's model and how often the guards changed a reply", () => {
    const guarded = { ...results, answers: [scored({ questionId: "a", rawText: "**A**" }), scored({ questionId: "b" })] };
    const out = renderReport(guarded, { random: () => 0 });
    expect(out).toMatch(/\| Setup \| Model \| Answers \|/);
    expect(out).toMatch(/\| Guards fired \|/);
    expect(summarize(guarded)[0].guardsFired).toBe(1);
    expect(out).toContain("| v1 | deepseek/deepseek-v4-pro |");
  });
  it("gates against the run's first setup when the baseline setup didn't run in it", () => {
    const models = { ...results, baseline: "f", setups: ["m-v4pro", "m-haiku"],
      models: { judge: "j", agent: { "m-v4pro": "deepseek/deepseek-v4-pro", "m-haiku": "anthropic/claude-haiku-5.5" } },
      answers: [scored({ setupId: "m-v4pro" }), scored({ setupId: "m-haiku", judge: { ...scored({}).judge!, rules: { ...scored({}).judge!.rules, after_death: rule(false) } } })] };
    const out = renderReport(models, { random: () => 0 });
    expect(out).toContain("Gate measured against: m-v4pro");
    expect(out).toMatch(/\(a\) Hard rules as a gate, then side-by-side wins:\*\* m-v4pro/);
    expect(out).not.toMatch(/\(a\)[^\n]*m-haiku/);
  });
  it("ranks under the three criteria", () => {
    expect(md).toContain("Hard rules as a gate, then side-by-side wins");
    expect(md).toContain("Weighted score");
    expect(md).toContain("Cheapest at least as good as the baseline");
  });
  it("names the commit the answers ran on", () => {
    expect(renderReport({ ...results, code: [{ commit: "13fa689", uncommitted: [] }] }, { random: () => 0 })).toContain("Code: commit 13fa689.");
    expect(md).toContain("Code: commit not recorded.");
  });
  it("names the models that were measured and the judge", () => {
    expect(md).toContain("v1: deepseek/deepseek-v4-pro");
    expect(md).toContain("Judge: deepseek/deepseek-v4.1-flash");
  });
  it("shows cut-off replies and tokens per answer", () => {
    const [s] = summarize(results);
    expect(s.truncated).toBe(1);
    expect(s.tokensMean).toEqual({ input: 101, output: 34 });
    expect(md).toContain("Cut off");
  });
  it("explains what replay can't measure", () => {
    expect(md).toMatch(/extra lookups.*show as FAILED/i);
    expect(md).toMatch(/replayed times leave out the lookups' own time/i);
    expect(md).toMatch(/earlier turns.*no classifier reading/i);
  });
  it("lists a failed side-by-side apart from answers the judge couldn't score", () => {
    const r: RunResults = { ...results, answers: [scored({ questionId: "p", pairError: "bad json" })] };
    const text = renderReport(r, { random: () => 0 });
    expect(text).toContain("Side-by-side failed: v1/p");
    expect(text).not.toContain("Not scored (judge failed): v1/p");
  });
});

describe("weighted", () => {
  it("never goes below zero when the judge failed on most answers", () => {
    const [s] = summarize({ ...results, answers: [
      scored({ questionId: "x", judge: null, faithfulness: null, checks: { ...scored({}).checks!, paragraphs: 5 } }),
      scored({ questionId: "y", judge: null, faithfulness: null, checks: { ...scored({}).checks!, paragraphs: 5 } }),
      scored({ questionId: "z" }),
    ] });
    expect(weighted(s)).toBeGreaterThanOrEqual(0);
  });
  it("gates a model run against m-v4pro wherever it is listed (final review #2)", () => {
    const run = { ...results, baseline: "f", setups: ["m-haiku", "m-v4pro"],
      models: { judge: "j", agent: { "m-v4pro": "deepseek/deepseek-v4-pro", "m-haiku": "anthropic/claude-haiku-5.5" } },
      answers: [scored({ setupId: "m-haiku" }), scored({ setupId: "m-v4pro" })] };
    expect(renderReport(run, { random: () => 0 })).toContain("Gate measured against: m-v4pro");
  });
});
