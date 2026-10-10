import { afterEach, describe, expect, it, vi } from "vitest";
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
  afterEach(() => vi.unstubAllEnvs());
  const setups = [{ id: "v0" }, { id: "m-v4pro", modelId: "deepseek/deepseek-v4-pro" }, { id: "m-kimi", modelId: "moonshotai/kimi-k2.6" }] as never;
  const a = (setupId: string, lookups = "live", error: string | null = null) => ({ setupId, lookups, error }) as never;
  const answers = () => [a("v0"), a("m-v4pro"), a("m-kimi"), a("v0", "replay"), a("v0", "live", "down")];
  const ids = (xs: { setupId: string }[]) => xs.map((x) => x.setupId);
  it("measures live cost only on the price reference (v4-pro), so a model round can't skew later estimates", () => {
    vi.stubEnv("AGENT_MODEL", "deepseek/deepseek-v4-pro");
    expect(ids(measuredLiveAnswers(answers(), setups))).toEqual(["v0", "m-v4pro"]);
  });
  it("leaves out the app's own setups once the app runs another model (Haiku since Phase 5)", () => {
    vi.stubEnv("AGENT_MODEL", "anthropic/claude-haiku-5.5");
    expect(ids(measuredLiveAnswers(answers(), setups))).toEqual(["m-v4pro"]);
  });
});
