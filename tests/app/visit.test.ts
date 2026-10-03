import { describe, expect, it } from "vitest";
import { foldVisit, isEnded, VISIT_RULES } from "@/lib/visit";
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
const curt = act({ act: "question", offense: 1 });
const questions = (n: number) => Array.from({ length: n }, () => act());
const curts = (n: number) => Array.from({ length: n }, () => curt);

describe("foldVisit", () => {
  it("starts neutral", () => {
    expect(foldVisit([])).toMatchObject({ patience: 0, turns: 0, left: false, ended: null, wants: null, language: null });
  });

  it("drifts back toward neutral", () => {
    const v = foldVisit([curt, act()]);
    expect(v.patience).toBeCloseTo(-0.5 * 0.85);
  });

  // Spec §23.5: offense 2+ ends the visit at once, whatever the act.
  it("leaves on the first insult, and only that turn is the exit line", () => {
    const first = foldVisit([act(), insult]);
    expect(first).toMatchObject({ left: true, leavingNow: true, ended: "offended", closed: true });
    expect(first.patience).toBe(VISIT_RULES.min);
    expect(foldVisit([insult, act()])).toMatchObject({ left: true, leavingNow: false, closed: true });
  });

  it("leaves on a greeting phrased as an insult", () => {
    expect(foldVisit([act({ act: "greeting", offense: 2 })])).toMatchObject({ left: true, leavingNow: true, ended: "offended" });
  });

  it("only charges patience for curt messages, until a long run of them", () => {
    expect(foldVisit(curts(5))).toMatchObject({ left: false, rudeSoFar: true });
    expect(foldVisit(curts(30)).left).toBe(true);
  });

  it("leaves at once on abuse", () => {
    expect(foldVisit([act({ act: "insult", offense: 3 })])).toMatchObject({ left: true, leavingNow: true, patience: -5 });
  });

  it("lets an apology repair patience before the second low turn", () => {
    // 15 curt turns reach the leave threshold once; a 16th would make it twice in a row.
    expect(foldVisit([...curts(15), curt]).left).toBe(true);
    expect(foldVisit([...curts(15), act({ act: "apology" }), curt]).left).toBe(false);
  });

  it("only counts an apology when patience is negative", () => {
    expect(foldVisit([act({ act: "apology" })]).patience).toBe(0);
  });

  it("charges nothing for disagreement, and a sore point only on top of an offense", () => {
    expect(foldVisit([act({ act: "disagreement" })]).patience).toBe(0);
    expect(foldVisit([act({ act: "disagreement", sorePoint: true })])).toMatchObject({ patience: 0, sorePoint: true, rudeSoFar: false });
    expect(foldVisit([act({ offense: 1, sorePoint: true })])).toMatchObject({ patience: -1.5, sorePoint: true, rudeSoFar: true });
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

  it("marks the farewell turn as the ending", () => {
    expect(foldVisit([act(), act({ act: "farewell" })])).toMatchObject({ farewell: true, ended: "farewell" });
  });

  it("is closed once an earlier act ended the visit", () => {
    expect(foldVisit([]).closed).toBe(false);
    expect(foldVisit([act(), act()]).closed).toBe(false);
    // Folding the earlier acts: a farewell anywhere closes the visit, even when acts follow it.
    expect(foldVisit([act({ act: "farewell" })]).closed).toBe(true);
    expect(foldVisit([act({ act: "farewell" }), act(), act()]).closed).toBe(true);
    expect(foldVisit([insult, insult, insult]).closed).toBe(true);
    expect(foldVisit([act({ act: "insult", offense: 3 })]).closed).toBe(true);
  });

  it("closes after the wind-down turn, not before", () => {
    expect(foldVisit(questions(VISIT_RULES.windDownAt - 1)).closed).toBe(false);
    expect(foldVisit(questions(VISIT_RULES.windDownAt)).closed).toBe(true);
  });

  it("never closes on a null act", () => {
    expect(foldVisit([null, null]).closed).toBe(false);
    expect(foldVisit(Array.from({ length: 5 }, () => null)).closed).toBe(false);
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

describe("isEnded", () => {
  it("is true when any message carries an ending", () => {
    expect(isEnded([{}, {}])).toBe(false);
    expect(isEnded([{}, { ended: "farewell" }])).toBe(true);
    expect(isEnded([{}, { ended: "tired" }])).toBe(true);
    expect(isEnded([{}, { ended: "offended" }])).toBe(true);
  });
});
