import { describe, expect, it } from "vitest";
import { FIELDS, loadCases, loadProfiles, parseArgs, planMicros, PROBE_MODELS, scoreCase } from "../../eval/classifier-probe";
import { VISITOR_ACTS } from "@/lib/visitor-act";

const act = { act: "question", offense: 0, sorePoint: false, language: "en", wants: "normal", visitorName: null } as const;

describe("classifier probe", () => {
  it("loads labelled cases for known personas, covering every act", () => {
    const cases = loadCases();
    const profiles = loadProfiles();
    expect(cases.length).toBeGreaterThanOrEqual(30);
    for (const c of cases) expect(profiles.has(c.persona), c.id).toBe(true);
    const acts = new Set(cases.flatMap((c) => ([] as string[]).concat(c.expect.act)));
    for (const a of VISITOR_ACTS) expect(acts.has(a), a).toBe(true);
  });
  it("scores a field right when it is one of the accepted labels", () => {
    const score = scoreCase({ ...act, act: ["question", "followup"], wants: ["brief", "normal"], offense: 1 }, act);
    expect(score.act).toBe(true);
    expect(score.wants).toBe(true);
    expect(score.offense).toBe(false);
    expect(score.all).toBe(false);
    expect(scoreCase(act, act).all).toBe(true);
  });
  it("gets nothing right for no answer", () => {
    const score = scoreCase(act, null);
    for (const f of FIELDS) expect(score[f]).toBe(false);
  });
  it("estimates a fixed price from tokens and plans a variable price at its cap", () => {
    const prices = new Map([
      ["deepseek/deepseek-v4.1-flash", { prompt: 0.0328, completion: 0.08 }],
      ["typesafe/jev-router", { prompt: -1_000_000, completion: -1_000_000 }],
    ]);
    const { estimate, lines } = planMicros(PROBE_MODELS, 32, prices, 250_000);
    expect(estimate).toBeGreaterThan(250_000);
    expect(estimate).toBeLessThan(260_000);
    expect(lines[1]).toMatch(/no fixed price; capped at/);
    expect(() => planMicros(PROBE_MODELS, 1, new Map(), 1)).toThrow(/not on OpenRouter's price list/);
  });
  it("reads its options and refuses a bad cap", () => {
    expect(parseArgs([])).toEqual({ models: "flash,jev", cases: "all", cap: 0.25, name: "classifier-probe", confirm: false });
    expect(parseArgs(["--cap", "0.1", "--confirm", "--models", "jev"])).toMatchObject({ cap: 0.1, confirm: true, models: "jev" });
    expect(() => parseArgs(["--cap", "-1"])).toThrow(/positive/);
  });
});
