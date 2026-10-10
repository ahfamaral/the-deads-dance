import type { PersonaRow } from "@corpus/personas";
import { formatDollars, RunSpend, RUN_LIMIT_MICROS, TOTAL_LIMIT_MICROS } from "./budget";
import type { Judge } from "./judge";
import { runQuestion, type QuestionDeps } from "./run-question";
import { scoreAnswer } from "./score";
import type { Setup } from "./setups";
import type { AnswerRecord, CodeVersion, Question, Recording, RunResults, ScoredAnswer } from "./types";

export type RunOpts = {
  name: string;
  setups: Setup[];
  questions: Question[];
  personaFor: (slug: string) => Promise<PersonaRow | null>;
  deps: QuestionDeps;
  judge: Judge;
  baseline: { setupId: string; answers: Map<string, AnswerRecord> } | null;
  saveRecording: (r: Recording) => void;
  judgeCallMicros: number;
  estimateMicros: number;
  spend?: RunSpend;
  stopRequested?: () => boolean;
  log?: (line: string) => void;
  now?: () => Date;
  models: RunResults["models"];
  code?: CodeVersion;
  /** Called with the run's spend after every answer, so the budget file is current if the run dies. */
  onSpend?: (micros: number) => void;
  /** Prices the judge calls made since the last call; without it, each call costs judgeCallMicros. */
  priceJudge?: () => Promise<number>;
};

const MAX_FAILURES_IN_A_ROW = 3;

/** Spec §29.5 (saving 6): each persona's questions back to back, so the prompt's fixed start can be cached. */
function byPersona(questions: Question[]): Question[] {
  const order = [...new Set(questions.map((q) => q.persona))];
  return order.flatMap((p) => questions.filter((q) => q.persona === p));
}

const failed = (q: Question, setup: Setup, error: string): ScoredAnswer => ({
  questionId: q.id, setupId: setup.id, persona: q.persona, category: q.category, text: null, error, truncated: false,
  toolCalls: [], lookups: "live", durationMs: 0, answerMicros: 0, inputTokens: 0, outputTokens: 0,
  checks: null, judge: null, judgeError: null, pairError: null, faithfulness: null, contextPrecision: null, retrieval: null, pair: null, judgeMicros: 0,
});

/** The judge's real price when it can be priced; the per-call estimate otherwise (never zero for calls made). */
async function judgeCost(opts: RunOpts, calls: number): Promise<number> {
  if (!calls) return 0;
  if (!opts.priceJudge) return calls * opts.judgeCallMicros;
  try {
    return await opts.priceJudge();
  } catch {
    return calls * opts.judgeCallMicros;
  }
}

/** Spec §29.4 and §29.8: runs and scores; stops at $1, after 3 failures in a row, or on request, keeping what is done. */
export async function runEval(opts: RunOpts): Promise<RunResults> {
  const spend = opts.spend ?? new RunSpend();
  const log = opts.log ?? (() => {});
  const answers: ScoredAnswer[] = [];
  const personas = new Map<string, PersonaRow | null>();
  let stoppedReason: string | null = null;
  let failuresInARow = 0;

  outer: for (const setup of opts.setups) {
    for (const q of byPersona(opts.questions)) {
      if (opts.stopRequested?.()) {
        stoppedReason = "stopped by the user";
        break outer;
      }
      if (!personas.has(q.persona)) personas.set(q.persona, await opts.personaFor(q.persona));
      const persona = personas.get(q.persona);
      if (!persona || persona.status !== "ready") {
        answers.push(failed(q, setup, `Persona ${q.persona} is missing or not ready.`));
        continue;
      }

      let scored: ScoredAnswer;
      try {
        const { answer, recording } = await runQuestion(opts.deps, q, setup, persona);
        // Ctrl-C reaches the MCP child too, so a question that finished after it may hold failed lookups.
        if (recording && !opts.stopRequested?.()) opts.saveRecording(recording);
        const baseline = opts.baseline && opts.baseline.setupId !== setup.id ? (opts.baseline.answers.get(q.id) ?? null) : null;
        const result = await scoreAnswer({ answer, question: q, persona, judge: opts.judge, baseline });
        scored = result.scored;
        scored.judgeMicros = await judgeCost(opts, result.judgeCalls);
      } catch (err) {
        // Spec §29.8: whatever throws (a file, the database) is an error answer; the run goes on.
        scored = failed(q, setup, err instanceof Error ? err.message : String(err));
      }
      answers.push(scored);
      spend.add(scored.answerMicros + scored.judgeMicros);
      opts.onSpend?.(spend.micros);
      log(`${setup.id} ${q.id}: ${scored.error ?? `${scored.checks?.words ?? 0} words`} · ${formatDollars(spend.micros)}`);

      failuresInARow = scored.error ? failuresInARow + 1 : 0;
      if (failuresInARow >= MAX_FAILURES_IN_A_ROW) {
        stoppedReason = `${MAX_FAILURES_IN_A_ROW} failures in a row`;
        break outer;
      }
      if (spend.over) {
        stoppedReason =
          spend.limitMicros === RUN_LIMIT_MICROS
            ? `reached the ${formatDollars(RUN_LIMIT_MICROS)} per run limit`
            : `reached ${formatDollars(spend.limitMicros)}, what was left of the ${formatDollars(TOTAL_LIMIT_MICROS)} in total`;
        break outer;
      }
    }
  }

  return {
    name: opts.name,
    startedAt: (opts.now?.() ?? new Date()).toISOString(),
    setups: opts.setups.map((s) => s.id),
    baseline: opts.baseline?.setupId ?? null,
    questions: opts.questions.map((q) => q.id),
    estimateMicros: opts.estimateMicros,
    actualMicros: spend.micros,
    stoppedReason,
    models: opts.models,
    ...(opts.code ? { code: [opts.code] } : {}),
    answers,
  };
}
