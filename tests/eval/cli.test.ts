import { describe, expect, it } from "vitest";
import { baselineWarning, parseArgs } from "../../eval/cli";

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
