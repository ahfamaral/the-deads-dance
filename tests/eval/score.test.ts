import { describe, expect, it, vi } from "vitest";
import { scoreAnswer } from "../../eval/score";
import type { Judge } from "../../eval/judge";
import type { AnswerRecord, JudgeResult, Question } from "../../eval/types";

const rule = { reason: "r", pass: true };
const verdict: JudgeResult = {
  claims: [{ claim: "c", reason: "r", backed: true }], relevancy: { reason: "r", score: 5 }, passages: [],
  rules: { after_death: rule, before_birth: rule, suicide: null, wrong_denial: rule, false_yes: rule, in_character: rule, as_expected: rule },
};
const answer = (over: Partial<AnswerRecord> = {}): AnswerRecord => ({
  questionId: "q1", setupId: "v1", persona: "albert-einstein", category: "ordinary", text: "In Ulm.", error: null, truncated: false,
  toolCalls: [], lookups: "replay", durationMs: 100, answerMicros: 2_000, inputTokens: 10, outputTokens: 5, ...over,
});
const question: Question = { id: "q1", persona: "albert-einstein", category: "ordinary", text: "Where?", expect: "Ulm", screening: true };
const persona = { displayName: "Albert Einstein", lifespan: "1879–1955" };
const judge = (over: Partial<Judge> = {}): Judge => ({ score: vi.fn(async () => verdict), compare: vi.fn(async () => ({ reason: "r", winner: "A" as const })), ...over });

describe("scoreAnswer (spec §29.6)", () => {
  it("runs the checks and one judge call, and computes faithfulness in code", async () => {
    const { scored, judgeCalls } = await scoreAnswer({ answer: answer(), question, persona, judge: judge(), baseline: null });
    expect(judgeCalls).toBe(1);
    expect(scored.checks?.words).toBe(2);
    expect(scored.faithfulness).toBe(1);
    expect(scored.pair).toBeNull();
  });

  it("skips the judge for an answer that already failed with an error (saving 4)", async () => {
    const j = judge();
    const { scored, judgeCalls } = await scoreAnswer({ answer: answer({ text: null, error: "down" }), question, persona, judge: j, baseline: null });
    expect(judgeCalls).toBe(0);
    expect(j.score).not.toHaveBeenCalled();
    expect(scored).toMatchObject({ checks: null, judge: null, faithfulness: null });
  });

  it("marks a judge failure as not scored, never as zero (Review Focus 3)", async () => {
    const { scored } = await scoreAnswer({ answer: answer(), question, persona, judge: judge({ score: async () => { throw new Error("bad json"); } }), baseline: null });
    expect(scored).toMatchObject({ judge: null, faithfulness: null, judgeError: "bad json" });
  });

  it("compares with the baseline in random order, and maps the winner back", async () => {
    const compare = vi.fn<Judge["compare"]>(async () => ({ reason: "r", winner: "A" as const }));
    const base = answer({ setupId: "v0", text: "Ulm, of course." });
    const first = await scoreAnswer({ answer: answer(), question, persona, judge: judge({ compare }), baseline: base, random: () => 0.1 });
    expect(compare.mock.calls[0][0]).toMatchObject({ a: "Ulm, of course.", b: "In Ulm." });
    expect(first.scored.pair).toEqual({ reason: "r", winner: "B", order: "baseline-first" }); // A was the baseline: the candidate lost
    const second = await scoreAnswer({ answer: answer(), question, persona, judge: judge({ compare }), baseline: base, random: () => 0.9 });
    expect(second.scored.pair).toEqual({ reason: "r", winner: "A", order: "candidate-first" });
    expect(second.judgeCalls).toBe(2);
  });

  it("keeps the judge's score when only the side-by-side fails, and notes it apart", async () => {
    const base = answer({ setupId: "v0", text: "Ulm." });
    const { scored } = await scoreAnswer({ answer: answer(), question, persona, baseline: base,
      judge: judge({ compare: async () => { throw new Error("bad json"); } }) });
    expect(scored).toMatchObject({ judgeError: null, pairError: "bad json", pair: null, faithfulness: 1 });
  });

  it("scores the suicide rule only on death questions, whatever the judge returned", async () => {
    const withSuicide = { ...verdict, rules: { ...verdict.rules, suicide: { reason: "n/a", pass: true } } };
    const j = judge({ score: async () => withSuicide });
    expect((await scoreAnswer({ answer: answer(), question, persona, judge: j, baseline: null })).scored.judge?.rules.suicide).toBeNull();
    const death = { ...question, category: "death" as const };
    expect((await scoreAnswer({ answer: answer(), question: death, persona, judge: j, baseline: null })).scored.judge?.rules.suicide).toEqual({ reason: "n/a", pass: true });
  });
});
