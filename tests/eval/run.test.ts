import { describe, expect, it, vi } from "vitest";
import { RunSpend } from "../../eval/budget";
import type { Judge } from "../../eval/judge";
import { runEval, type RunOpts } from "../../eval/run";
import type { AnswerRecord, Question } from "../../eval/types";

vi.mock("../../eval/run-question", () => ({
  runQuestion: vi.fn(async (_deps, q: Question, setup: { id: string }) => {
    if (q.text === "throw") throw new Error("disk full");
    return {
    answer: { questionId: q.id, setupId: setup.id, persona: q.persona, category: q.category, text: q.text === "fail" ? null : "An answer.",
      error: q.text === "fail" ? "down" : null, truncated: false, toolCalls: [], lookups: "live", durationMs: 1, answerMicros: 300_000, inputTokens: 1, outputTokens: 1 } satisfies AnswerRecord,
    recording: { questionId: q.id, question: q.text, act: null, tools: [] },
  };
  }),
}));

const rule = { reason: "r", pass: true };
const judge: Judge = {
  score: async () => ({ claims: [], relevancy: { reason: "r", score: 4 }, passages: [],
    rules: { after_death: rule, before_birth: rule, suicide: null, wrong_denial: rule, false_yes: rule, in_character: rule, as_expected: rule } }),
  compare: async () => ({ reason: "r", winner: "tie" }),
};
const q = (id: string, persona = "albert-einstein", text = "Q?"): Question => ({ id, persona, category: "ordinary", text, expect: "E", screening: true });
const persona = { slug: "albert-einstein", displayName: "Albert Einstein", lifespan: "1879–1955", status: "ready" } as never;
const opts = (over: Partial<RunOpts> = {}): RunOpts => ({
  name: "t", setups: [{ id: "v0" } as never], questions: [q("a"), q("b")], personaFor: async () => persona,
  deps: {} as never, judge, baseline: null, saveRecording: vi.fn(), judgeCallMicros: 1_000, estimateMicros: 0,
  now: () => new Date("2026-10-08T12:00:00Z"), models: { judge: "j", agent: { v0: "m" } }, ...over,
});

describe("runEval (spec §29.4, §29.8)", () => {
  it("runs every question for every setup, saves recordings and adds up the cost", async () => {
    const saveRecording = vi.fn();
    const r = await runEval(opts({ saveRecording }));
    expect(r.answers).toHaveLength(2);
    expect(saveRecording).toHaveBeenCalledTimes(2);
    expect(r.actualMicros).toBe(2 * (300_000 + 1_000));
    expect(r.stoppedReason).toBeNull();
    expect(r.models).toEqual({ judge: "j", agent: { v0: "m" } });
  });

  it("stops at $1 and keeps every answer done so far (Review Focus 1)", async () => {
    const r = await runEval(opts({ questions: [q("a"), q("b"), q("c"), q("d"), q("e")], spend: new RunSpend() }));
    expect(r.answers).toHaveLength(4); // 4 × 301,000 crosses $1 on the 4th
    expect(r.stoppedReason).toMatch(/\$1\.00/);
    expect(r.actualMicros).toBe(4 * 301_000);
  });

  it("stops after 3 failures in a row", async () => {
    const r = await runEval(opts({ questions: [q("a", undefined, "fail"), q("b", undefined, "fail"), q("c", undefined, "fail"), q("d")] }));
    expect(r.answers).toHaveLength(3);
    expect(r.stoppedReason).toMatch(/3 failures in a row/);
  });

  it("marks a missing or unready persona's questions as errors and goes on (Review Focus 5)", async () => {
    const r = await runEval(opts({ questions: [q("a", "nobody"), q("b")], personaFor: async (s) => (s === "nobody" ? null : persona) }));
    expect(r.answers[0]).toMatchObject({ questionId: "a", text: null, error: "Persona nobody is missing or not ready." });
    expect(r.answers[1].text).toBe("An answer.");
    expect(r.stoppedReason).toBeNull();
  });

  it("stops cleanly when asked (Ctrl-C), keeping what is done", async () => {
    let n = 0;
    const r = await runEval(opts({ questions: [q("a"), q("b"), q("c")], stopRequested: () => ++n > 1 }));
    expect(r.answers).toHaveLength(1);
    expect(r.stoppedReason).toMatch(/stopped by the user/);
  });

  it("groups questions by persona, so a persona's questions run back to back", async () => {
    const r = await runEval(opts({ questions: [q("a", "albert-einstein"), q("b", "abraham-lincoln"), q("c", "albert-einstein")] }));
    expect(r.answers.map((a) => a.questionId)).toEqual(["a", "c", "b"]);
  });

  it("turns a thrown question into an error answer and goes on", async () => {
    const r = await runEval(opts({ questions: [q("a", undefined, "throw"), q("b")] }));
    expect(r.answers[0]).toMatchObject({ questionId: "a", text: null, error: "disk full" });
    expect(r.answers[1].text).toBe("An answer.");
  });

  it("reports the running spend after every answer, so a crash loses at most one question", async () => {
    const onSpend = vi.fn();
    await runEval(opts({ onSpend }));
    expect(onSpend.mock.calls.map((c) => c[0])).toEqual([301_000, 602_000]);
  });

  it("doesn't save the recording of the question running when Ctrl-C came", async () => {
    const saveRecording = vi.fn();
    let checks = 0;
    // The first check (before "a") says go on; the stop arrives while "a" is running.
    const r = await runEval(opts({ saveRecording, stopRequested: () => checks++ >= 1, questions: [q("a"), q("b")] }));
    expect(saveRecording).not.toHaveBeenCalled();
    expect(r.answers.map((x) => x.questionId)).toEqual(["a"]);
  });

  it("prices judge calls with priceJudge when given", async () => {
    const r = await runEval(opts({ questions: [q("a")], priceJudge: async () => 1_234 }));
    expect(r.answers[0].judgeMicros).toBe(1_234);
    expect(r.actualMicros).toBe(300_000 + 1_234);
  });

  it("stops at a lower limit when less than $1 of the $7 is left", async () => {
    const r = await runEval(opts({ questions: [q("a"), q("b"), q("c")], spend: new RunSpend(500_000) }));
    expect(r.answers).toHaveLength(2);
    expect(r.stoppedReason).toMatch(/\$0\.50/);
  });
});
