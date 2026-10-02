import type { VisitorAct } from "./visitor-act";

/** Spec §18.3: every number the fold uses, in one place so they can be tuned. */
export const VISIT_RULES = {
  drift: 0.85,
  offense1: -0.5,
  offense2: -2,
  sorePoint: -1,
  thanks: 1,
  apology: 2,
  min: -5,
  max: 5,
  leaveAt: -3,
  leaveStreak: 2,
  tiredFrom: 36,
  windDownAt: 40,
} as const;

export type VisitEnding = "farewell" | "tired" | "offended";

export type Visit = {
  patience: number;
  /** Visitor turns so far, including ones the classifier couldn't read. */
  turns: number;
  left: boolean;
  /** The latest turn is the one where the persona leaves: its reply is the exit line. */
  leavingNow: boolean;
  farewell: boolean;
  afterFarewell: boolean;
  tired: boolean;
  windDown: boolean;
  sorePoint: boolean;
  /** Some act so far carried an offense: only then may the prompt call the visitor rude. */
  rudeSoFar: boolean;
  visitorName: string | null;
  wants: VisitorAct["wants"] | null;
  language: string | null;
  /** The ending this turn's reply carries; offended beats tired beats farewell. */
  ended: VisitEnding | null;
};

const clamp = (n: number) => Math.min(VISIT_RULES.max, Math.max(VISIT_RULES.min, n));

/** Pure and deterministic: the server folds the acts the browser sends back (spec §18.1, approach A). */
export function foldVisit(acts: (VisitorAct | null)[]): Visit {
  const r = VISIT_RULES;
  let patience = 0;
  let streak = 0;
  let left = false;
  let leavingNow = false;
  let visitorName: string | null = null;
  let latest: VisitorAct | null = null;
  let language: string | null = null;
  let rudeSoFar = false;

  // A for-of loop, not forEach: TypeScript narrows `let` variables assigned inside callbacks to their initial type.
  for (const [i, a] of acts.entries()) {
    if (!a) continue;
    const last = i === acts.length - 1;
    patience *= r.drift;
    if (a.offense === 1) patience += r.offense1;
    if (a.offense === 2) patience += r.offense2;
    // A sore point only stings when the visitor is rude about it; a polite question costs nothing.
    if (a.sorePoint && a.offense >= 1) patience += r.sorePoint;
    if (a.offense >= 1) rudeSoFar = true;
    if (a.act === "thanks") patience += r.thanks;
    if (a.act === "apology" && patience < 0) patience += r.apology;
    patience = clamp(patience);
    streak = patience <= r.leaveAt ? streak + 1 : 0;
    if (!left && (a.offense === 3 || streak >= r.leaveStreak)) {
      left = true;
      leavingNow = last;
      if (a.offense === 3) patience = r.min;
    }
    if (a.visitorName) visitorName = a.visitorName;
    if (a.language !== "und") language = a.language;
    latest = a;
  }

  const turns = acts.length;
  const lastAct: VisitorAct | null = acts.at(-1) ?? null;
  const farewell = lastAct?.act === "farewell";
  const windDown = turns === r.windDownAt;
  const ended = leavingNow ? "offended" : windDown ? "tired" : farewell ? "farewell" : null;
  const current = latest;
  return {
    patience,
    turns,
    left,
    leavingNow,
    farewell,
    afterFarewell: acts.at(-2)?.act === "farewell" && !farewell,
    tired: turns >= r.tiredFrom,
    windDown,
    sorePoint: lastAct?.sorePoint ?? false,
    rudeSoFar,
    visitorName,
    wants: current?.wants ?? null,
    language,
    ended,
  };
}

/** A conversation the persona left in offense is closed for good (spec §18.5). */
export function isHardEnded(messages: { ended?: VisitEnding }[]): boolean {
  return messages.some((m) => m.ended === "offended");
}
