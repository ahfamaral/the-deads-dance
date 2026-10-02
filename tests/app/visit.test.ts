import { describe, expect, it } from "vitest";
import { foldVisit, isHardEnded, VISIT_RULES } from "@/lib/visit";
import type { VisitorAct } from "@/lib/visitor-act";

const act = (over: Partial<VisitorAct> = {}): VisitorAct => ({
  act: "question",
  offense: 0,
  sorePoint: false,
  language: "en",
  wants: "normal",
  visitorName: null,
  ...over,
});
const insult = act({ act: "insult", offense: 2 });
const questions = (n: number) => Array.from({ length: n }, () => act());

describe("foldVisit", () => {
  it("starts neutral", () => {
    expect(foldVisit([])).toMatchObject({ patience: 0, turns: 0, left: false, ended: null, wants: null, language: null });
  });

  it("drifts back toward neutral", () => {
    const v = foldVisit([insult, act()]);
    expect(v.patience).toBeCloseTo(-2 * 0.85);
  });

  it("leaves on the third insult in a row, and only that turn is the exit line", () => {
    expect(foldVisit([insult, insult])).toMatchObject({ left: false });
    const third = foldVisit([insult, insult, insult]);
    expect(third).toMatchObject({ left: true, leavingNow: true, ended: "offended" });
    expect(third.patience).toBe(VISIT_RULES.min);
    expect(foldVisit([insult, insult, insult, act()])).toMatchObject({ left: true, leavingNow: false });
  });

  it("leaves at once on abuse", () => {
    expect(foldVisit([act({ act: "insult", offense: 3 })])).toMatchObject({ left: true, leavingNow: true, patience: -5 });
  });

  it("lets an apology repair patience before the second low turn", () => {
    const v = foldVisit([insult, insult, act({ act: "apology" }), insult]);
    expect(v.left).toBe(false);
  });

  it("only counts an apology when patience is negative", () => {
    expect(foldVisit([act({ act: "apology" })]).patience).toBe(0);
  });

  it("charges nothing for disagreement, and a sore point only on top of an offense", () => {
    expect(foldVisit([act({ act: "disagreement" })]).patience).toBe(0);
    expect(foldVisit([act({ act: "disagreement", sorePoint: true })])).toMatchObject({ patience: 0, sorePoint: true, rudeSoFar: false });
    expect(foldVisit([act({ act: "insult", offense: 2, sorePoint: true })])).toMatchObject({ patience: -3, sorePoint: true, rudeSoFar: true });
  });

  it("five polite sore-point questions never leave", () => {
    const polite = Array.from({ length: 5 }, () => act({ sorePoint: true }));
    expect(foldVisit(polite)).toMatchObject({ left: false, patience: 0, rudeSoFar: false });
  });

  it("counts the visit as rude once any act has an offense", () => {
    expect(foldVisit([act(), null]).rudeSoFar).toBe(false);
    expect(foldVisit([act({ act: "insult", offense: 1 }), act()]).rudeSoFar).toBe(true);
  });

  it("rewards thanks and clamps at +5", () => {
    expect(foldVisit(Array.from({ length: 30 }, () => act({ act: "thanks" }))).patience).toBeLessThanOrEqual(5);
    expect(foldVisit([act({ act: "thanks" })]).patience).toBe(1);
  });

  it("tires from turn 36 and winds down on turn 40 only", () => {
    expect(foldVisit(questions(35)).tired).toBe(false);
    expect(foldVisit(questions(36)).tired).toBe(true);
    expect(foldVisit(questions(40))).toMatchObject({ windDown: true, ended: "tired" });
    expect(foldVisit(questions(41))).toMatchObject({ windDown: false, tired: true, ended: null });
  });

  it("marks a farewell and a visitor who stays on", () => {
    expect(foldVisit([act(), act({ act: "farewell" })])).toMatchObject({ farewell: true, ended: "farewell" });
    expect(foldVisit([act({ act: "farewell" }), act()])).toMatchObject({ farewell: false, afterFarewell: true, ended: null });
  });

  it("marks staying on only on the turn right after the farewell", () => {
    expect(foldVisit([act({ act: "farewell" }), act(), act()]).afterFarewell).toBe(false);
    expect(foldVisit([act({ act: "farewell" }), act({ act: "farewell" })]).afterFarewell).toBe(false);
    expect(foldVisit([act({ act: "farewell" }), null]).afterFarewell).toBe(true);
  });

  it("lets offended beat tired, and tired beat farewell", () => {
    const abuse = act({ act: "farewell", offense: 3 });
    expect(foldVisit([...questions(39), abuse]).ended).toBe("offended");
    expect(foldVisit([...questions(39), act({ act: "farewell" })]).ended).toBe("tired");
  });

  it("carries the latest name, length and language, skipping null acts", () => {
    const v = foldVisit([act({ visitorName: "Maria", language: "de", wants: "long" }), null]);
    expect(v).toMatchObject({ visitorName: "Maria", language: "de", wants: "long", turns: 2 });
    expect(foldVisit([act({ visitorName: "Maria" }), act({ visitorName: "Ana" })]).visitorName).toBe("Ana");
  });

  it("keeps the latest known language when the newest act can't tell", () => {
    expect(foldVisit([act({ language: "de" }), act({ language: "und" })]).language).toBe("de");
    expect(foldVisit([act({ language: "und" })]).language).toBeNull();
  });

  it("ignores null acts for patience without breaking a low streak", () => {
    expect(foldVisit([insult, insult, null, insult]).left).toBe(true);
  });
});

describe("isHardEnded", () => {
  it("is true only when a message carries the offended ending", () => {
    expect(isHardEnded([{}, { ended: "farewell" }])).toBe(false);
    expect(isHardEnded([{}, { ended: "offended" }])).toBe(true);
  });
});
