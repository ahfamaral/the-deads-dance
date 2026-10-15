import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { z } from "zod";
import { formatDollars } from "@/lib/money";

export { formatDollars };

/** Spec §29.1: $1 per run, $7 in total; raising either needs the user's explicit OK. Raised to $8.50 by the user on 2026-10-15 for the OpenAI model round. */
export const RUN_LIMIT_MICROS = 1_000_000;
export const TOTAL_LIMIT_MICROS = 8_500_000;

/** Before the pilot measures them (spec §29.4): micro-dollars per item. */
export const DEFAULT_COSTS = { liveAnswer: 4_400, replayAnswer: 2_000, judge: 1_000, generate: 1_000 };

const BudgetSchema = z.strictObject({
  spentMicros: z.number().int().min(0),
  runs: z.array(z.strictObject({ name: z.string(), at: z.string(), micros: z.number().int().min(0) })),
  measured: z.strictObject({
    liveAnswer: z.number().int().positive().optional(),
    replayAnswer: z.number().int().positive().optional(),
    judge: z.number().int().positive().optional(),
    generate: z.number().int().positive().optional(),
  }),
});
export type BudgetFile = z.infer<typeof BudgetSchema>;

/** Missing: null (a first `--confirm` run creates it). Corrupt: refuse, never guess what was spent (spec §29.8). */
export function readBudget(path: string): BudgetFile | null {
  if (!existsSync(path)) return null;
  try {
    return BudgetSchema.parse(JSON.parse(readFileSync(path, "utf8")));
  } catch {
    throw new Error(`eval/budget.json is unreadable. Fix it by hand or restore it; the harness won't guess what was spent.`);
  }
}

export function writeBudget(path: string, budget: BudgetFile): void {
  writeFileSync(path, `${JSON.stringify(budget, null, 2)}\n`);
}

/** The budget file with one run's spend added; written after every answer, so a run that dies still counts. */
export function withRun(before: BudgetFile | null, run: BudgetFile["runs"][number]): BudgetFile {
  const base = before ?? { spentMicros: 0, runs: [], measured: {} };
  return { ...base, spentMicros: base.spentMicros + run.micros, runs: [...base.runs, run], measured: { ...base.measured } };
}

export function estimateMicros(
  plan: { live: number; replay: number; judged: number; pairs: number; generate?: number; liveOnModels?: number[] },
  measured: BudgetFile["measured"],
): number {
  const cost = { ...DEFAULT_COSTS, ...measured };
  return (
    plan.live * cost.liveAnswer +
    (plan.liveOnModels ?? []).reduce((s, scale) => s + liveAnswerMicros(measured, scale), 0) +
    plan.replay * cost.replayAnswer +
    (plan.judged + plan.pairs) * cost.judge +
    (plan.generate ?? 0) * cost.generate
  );
}

/** Spec §30.6: a live answer on another persona model: the lookups as measured, the persona's own calls scaled by price. */
export function liveAnswerMicros(measured: BudgetFile["measured"], scale = 1): number {
  const cost = { ...DEFAULT_COSTS, ...measured };
  return Math.round(Math.max(0, cost.liveAnswer - cost.replayAnswer) + cost.replayAnswer * scale);
}

export function checkLimits(estimate: number, spent: number): string | null {
  if (estimate > RUN_LIMIT_MICROS) {
    return `This run is estimated at ${formatDollars(estimate)}, over the ${formatDollars(RUN_LIMIT_MICROS)} per run limit. Run fewer questions or setups.`;
  }
  if (spent + estimate > TOTAL_LIMIT_MICROS) {
    return `This run (${formatDollars(estimate)}) would pass the ${formatDollars(TOTAL_LIMIT_MICROS)} in total limit: ${formatDollars(TOTAL_LIMIT_MICROS - spent)} is left.`;
  }
  return null;
}

/** Spec §29.4: the dry run's text. The harness never prompts; "banana" is typed in chat, then Claude adds --confirm. */
export function describeEstimate(opts: { estimate: number; spent: number; creating: boolean; confirmed?: boolean }): string {
  const left = TOTAL_LIMIT_MICROS - opts.spent;
  return [
    `Estimated cost: ${formatDollars(opts.estimate)} (stops at ${formatDollars(RUN_LIMIT_MICROS)}).`,
    `${formatDollars(left)} left of ${formatDollars(TOTAL_LIMIT_MICROS)} in total.`,
    opts.creating ? "This run creates eval/budget.json." : null,
    opts.confirmed ? "Confirmed: starting now." : "Dry run: nothing was spent. Add --confirm to start.",
  ].filter(Boolean).join("\n");
}

/** Spec §29.1: a run stops at $1, or sooner when less than $1 of the $7 is left. */
export function runLimitMicros(spent: number): number {
  return Math.min(RUN_LIMIT_MICROS, TOTAL_LIMIT_MICROS - spent);
}

/** Spec §29.4: checked after every answer; at the limit the run stops and keeps what is done. */
export class RunSpend {
  #micros = 0;
  constructor(private readonly limit = RUN_LIMIT_MICROS) {}
  add(micros: number): void {
    this.#micros += micros;
  }
  get micros(): number {
    return this.#micros;
  }
  get limitMicros(): number {
    return this.limit;
  }
  get over(): boolean {
    return this.#micros >= this.limit;
  }
}
