import { runChecks } from "./checks";
import { contextPrecision, faithfulness, type Judge } from "./judge";
import { scoreRetrieval } from "./retrieval";
import type { AnswerRecord, PairResult, Question, ScoredAnswer } from "./types";

/**
 * Spec §29.6: free checks, then one judge call, then (against a baseline) one side-by-side call.
 * An answer that failed with an error skips the judge. A pair is stored from the candidate's side:
 * "A" means the candidate won.
 */
export async function scoreAnswer(opts: {
  answer: AnswerRecord;
  question: Question;
  persona: { displayName: string; lifespan: string };
  judge: Judge;
  baseline: AnswerRecord | null;
  random?: () => number;
}): Promise<{ scored: ScoredAnswer; judgeCalls: number }> {
  const { answer, question, persona, judge } = opts;
  const empty: ScoredAnswer = {
    ...answer, checks: null, judge: null, judgeError: null, pairError: null, faithfulness: null, contextPrecision: null,
    retrieval: scoreRetrieval(answer.toolCalls, question.section), pair: null, judgeMicros: 0,
  };
  if (answer.text === null) return { scored: empty, judgeCalls: 0 };

  const scored: ScoredAnswer = { ...empty, checks: runChecks(answer.text, answer.toolCalls, persona.lifespan) };
  let judgeCalls = 1;
  try {
    const j = await judge.score({
      personaName: persona.displayName, lifespan: persona.lifespan, question: question.text, history: question.history,
      category: question.category, expect: question.expect, answer: answer.text, toolCalls: answer.toolCalls,
    });
    scored.judge = j;
    scored.faithfulness = faithfulness(j);
    scored.contextPrecision = contextPrecision(j);
  } catch (err) {
    scored.judgeError = err instanceof Error ? err.message : String(err);
  }

  if (opts.baseline?.text) {
    judgeCalls++;
    const baselineFirst = (opts.random ?? Math.random)() < 0.5;
    const [a, b] = baselineFirst ? [opts.baseline.text, answer.text] : [answer.text, opts.baseline.text];
    try {
      const r = await judge.compare({ question: question.text, expect: question.expect, toolCalls: answer.toolCalls, a, b });
      const winner: PairResult["winner"] = r.winner === "tie" ? "tie" : (r.winner === "A") === !baselineFirst ? "A" : "B";
      scored.pair = { reason: r.reason, winner, order: baselineFirst ? "baseline-first" : "candidate-first" };
    } catch (err) {
      scored.pairError = err instanceof Error ? err.message : String(err);
    }
  }
  return { scored, judgeCalls };
}
