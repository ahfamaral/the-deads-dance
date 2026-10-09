import { describe, expect, it } from "vitest";
import { baselineFrom, baselineWarning, measuredLiveAnswers, parseArgs } from "../../eval/cli";

describe("parseArgs", () => {
  it("reads setups, questions, baseline, name and confirm, with defaults (a dry run)", () => {
    expect(parseArgs(["--setups", "v0,v1", "--confirm", "--questions", "screening", "--baseline", "eval/runs/x", "--name", "s1"]))
      .toEqual({ setups: "v0,v1", questions: "screening", baseline: "eval/runs/x", name: "s1", confirm: true });
    expect(parseArgs([])).toEqual({ setups: "v0", questions: "screening", baseline: null, name: "run", confirm: false });
  });
  it("rejects an unknown flag", () => {
    expect(() => parseArgs(["--budget", "5"])).toThrow(/Unknown option --budget/);
  });
});

describe("baselineWarning", () => {
  it("warns when a setup is compared with a run of itself, which gives no side-by-side", () => {
    expect(baselineWarning(["v0"], "v0")).toMatch(/v0 is the baseline's own setup/);
    expect(baselineWarning(["v0", "v1"], "v0")).toMatch(/v0 is the baseline's own setup/);
    expect(baselineWarning(["v1"], "v0")).toBeNull();
  });
});

describe("baselineFrom (spec §30.4)", () => {
  const prior = { setups: ["v0", "f"], answers: [
    { setupId: "v0", questionId: "a", text: "x" }, { setupId: "f", questionId: "a", text: "y" },
  ] } as never;
  it("uses the run's first setup by default, or the one named", () => {
    expect(baselineFrom(prior, null).setupId).toBe("v0");
    expect(baselineFrom(prior, "f").answers.get("a")?.text).toBe("y");
  });
  it("refuses a setup that isn't in that run", () => {
    expect(() => baselineFrom(prior, "v3")).toThrow(/v3 isn't in that run; it has v0, f/);
  });
});

describe("measuredLiveAnswers (final review #1)", () => {
  it("measures live cost only on the app's own model, so a model round can't skew later estimates", () => {
    const setups = [{ id: "v0" }, { id: "m-v4pro", modelId: "deepseek/deepseek-v4-pro" }, { id: "m-kimi", modelId: "moonshotai/kimi-k2.6" }] as never;
    const a = (setupId: string, lookups = "live", error: string | null = null) => ({ setupId, lookups, error }) as never;
    const kept = measuredLiveAnswers([a("v0"), a("m-v4pro"), a("m-kimi"), a("v0", "replay"), a("v0", "live", "down")], setups);
    expect(kept.map((x: { setupId: string }) => x.setupId)).toEqual(["v0", "m-v4pro"]);
  });
});
