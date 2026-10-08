import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  DEFAULT_COSTS, RUN_LIMIT_MICROS, RunSpend, TOTAL_LIMIT_MICROS,
  checkLimits, describeEstimate, estimateMicros, readBudget, runLimitMicros, withRun, writeBudget,
} from "../../eval/budget";

const dir = () => mkdtempSync(join(tmpdir(), "eval-budget-"));

describe("the budget file (spec §29.8)", () => {
  it("is null when missing, round-trips, and refuses when corrupt", () => {
    const path = join(dir(), "budget.json");
    expect(readBudget(path)).toBeNull();
    writeBudget(path, { spentMicros: 250_000, runs: [{ name: "pilot", at: "2026-10-08", micros: 250_000 }], measured: { liveAnswer: 5_000 } });
    expect(readBudget(path)?.spentMicros).toBe(250_000);
    writeFileSync(path, "{ not json");
    expect(() => readBudget(path)).toThrow(/unreadable/);
    writeFileSync(path, JSON.stringify({ spentMicros: -1, runs: [], measured: {} }));
    expect(() => readBudget(path)).toThrow(/unreadable/);
  });
});

describe("estimateMicros", () => {
  it("uses measured costs where known, defaults otherwise", () => {
    const plan = { live: 10, replay: 20, judged: 30, pairs: 20 };
    expect(estimateMicros(plan, {})).toBe(10 * DEFAULT_COSTS.liveAnswer + 20 * DEFAULT_COSTS.replayAnswer + 50 * DEFAULT_COSTS.judge);
    expect(estimateMicros({ live: 1, replay: 0, judged: 0, pairs: 0 }, { liveAnswer: 7_000 })).toBe(7_000);
    expect(estimateMicros({ live: 0, replay: 0, judged: 0, pairs: 0, generate: 11 }, {})).toBe(11 * DEFAULT_COSTS.generate);
  });
});

describe("checkLimits", () => {
  it("refuses an estimate over $1, or over what is left of $7", () => {
    expect(checkLimits(RUN_LIMIT_MICROS, 0)).toBeNull();
    expect(checkLimits(RUN_LIMIT_MICROS + 1, 0)).toMatch(/\$1\.00 per run/);
    expect(checkLimits(600_000, TOTAL_LIMIT_MICROS - 500_000)).toMatch(/\$7\.00 in total/);
  });
});

describe("describeEstimate", () => {
  it("shows the estimate, what's left, that the budget file will be created, and how to start", () => {
    const shown = describeEstimate({ estimate: 300_000, spent: 1_000_000, creating: true });
    expect(shown).toMatch(/\$0\.30/);
    expect(shown).toMatch(/\$6\.00 left of \$7\.00/);
    expect(shown).toMatch(/creates eval\/budget\.json/);
    expect(shown).toMatch(/Dry run: nothing was spent/);
    expect(shown).toMatch(/--confirm/);
  });
  it("leaves out the budget-file line when it already exists", () => {
    expect(describeEstimate({ estimate: 300_000, spent: 0, creating: false })).not.toMatch(/budget\.json/);
  });
});

describe("withRun", () => {
  it("adds a run's spend to what was spent before it, without touching the original", () => {
    const before = { spentMicros: 1_000_000, runs: [{ name: "pilot", at: "a", micros: 1_000_000 }], measured: {} };
    const after = withRun(before, { name: "baseline", at: "b", micros: 250_000 });
    expect(after.spentMicros).toBe(1_250_000);
    expect(after.runs.map((r) => r.name)).toEqual(["pilot", "baseline"]);
    expect(before.runs).toHaveLength(1);
    expect(withRun(null, { name: "first", at: "c", micros: 5 }).spentMicros).toBe(5);
  });
});

describe("runLimitMicros", () => {
  it("is $1, or what is left of the $7 when that is less", () => {
    expect(runLimitMicros(0)).toBe(RUN_LIMIT_MICROS);
    expect(runLimitMicros(TOTAL_LIMIT_MICROS - 400_000)).toBe(400_000);
  });
});

describe("RunSpend", () => {
  it("is over once the run reaches $1", () => {
    const spend = new RunSpend();
    spend.add(999_999);
    expect(spend.over).toBe(false);
    spend.add(1);
    expect(spend.over).toBe(true);
    expect(spend.micros).toBe(RUN_LIMIT_MICROS);
  });
});
