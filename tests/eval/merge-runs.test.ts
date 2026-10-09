import { describe, expect, it } from "vitest";
import { checkMergeDirs, mergeResults } from "../../eval/merge-runs";
import type { RunResults } from "../../eval/types";

const run = (over: Partial<RunResults>): RunResults => ({
  name: "r", startedAt: "2026-10-09T10:00:00Z", setups: ["v0"], baseline: "v0", questions: ["a"],
  estimateMicros: 100, actualMicros: 90, stoppedReason: null,
  models: { judge: "deepseek/deepseek-v4.1-flash", agent: { v0: "deepseek/deepseek-v4-pro" } }, answers: [], ...over,
});
const ans = (setupId: string, questionId: string, text: string) => ({ setupId, questionId, text }) as never;

describe("mergeResults (spec §30.4)", () => {
  it("unions setups, questions, models and answers; adds up money; records the note", () => {
    const merged = mergeResults(
      run({ answers: [ans("v0", "a", "1")] }),
      run({ setups: ["v0", "f"], questions: ["b"], estimateMicros: 50, actualMicros: 40, models: { judge: "deepseek/deepseek-v4.1-flash", agent: { f: "deepseek/deepseek-v4-pro" } },
        answers: [ans("v0", "b", "2"), ans("f", "b", "3")] }),
      "second half",
    );
    expect(merged.setups).toEqual(["v0", "f"]);
    expect(merged.questions).toEqual(["a", "b"]);
    expect(merged.actualMicros).toBe(130);
    expect(merged.estimateMicros).toBe(150);
    expect(merged.answers).toHaveLength(3);
    expect(merged.notes).toEqual(["second half"]);
    expect(Object.keys(merged.models.agent)).toEqual(["v0", "f"]);
  });
  it("keeps one answer per setup and question: the newer", () => {
    const merged = mergeResults(run({ answers: [ans("v0", "a", "old")] }), run({ answers: [ans("v0", "a", "new")] }), "redo");
    expect(merged.answers).toEqual([ans("v0", "a", "new")]);
  });
  it("refuses runs graded by different judges", () => {
    expect(() => mergeResults(run({}), run({ models: { judge: "other/judge", agent: {} } }), "x")).toThrow(/different judges/);
  });
  it("refuses halves compared with different baselines, and a run merged into itself (final review #8)", () => {
    expect(() => mergeResults(run({ baseline: "v0" }), run({ baseline: "f" }), "x")).toThrow(/different baselines/);
    expect(() => checkMergeDirs("eval/runs/a", "eval/runs/a/")).toThrow(/into itself/);
    expect(() => checkMergeDirs("eval/runs/a", "eval/runs/b")).not.toThrow();
  });
});
