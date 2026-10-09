import { formatDollars, TOTAL_LIMIT_MICROS } from "./budget";
import type { RunResults, ScoredAnswer } from "./types";

export type SetupSummary = {
  setupId: string; answers: number; errors: number; scored: number;
  rules: Record<string, number | null>;
  faithfulness: number | null; relevancy: number | null; contextPrecision: number | null;
  recallAt3: number | null; mrr: number | null;
  wordsMedian: number | null; wordsMax: number | null; overTwoParagraphs: number; markdown: number; assistantPhrases: number;
  /** Answers with checks (a text to measure): the base for length and markdown counts. */
  checked: number;
  /** Replies cut off at the agent's max_tokens (spec §28.2). */
  truncated: number;
  tokensMean: { input: number; output: number } | null;
  costPerAnswerMicros: number; msMedian: number | null; msMax: number | null;
  pairs: { wins: number; ties: number; losses: number; baselineFirstWins: number; candidateFirstWins: number } | null;
};

const RULES = ["after_death", "before_birth", "suicide", "wrong_denial", "false_yes", "in_character", "as_expected"] as const;
/** Spec §29.7 (a): a finalist is never worse than the baseline on these. */
const HARD_RULES = ["suicide", "after_death", "false_yes"] as const;

const mean = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null);
const median = (xs: number[]) => {
  if (!xs.length) return null;
  const s = [...xs].sort((a, b) => a - b);
  return s[Math.floor((s.length - 1) / 2)];
};
const pct = (x: number | null) => (x === null ? "—" : `${Math.round(x * 100)}%`);
const num = (x: number | null, d = 2) => (x === null ? "—" : x.toFixed(d));

function summarizeGroup(setupId: string, answers: ScoredAnswer[]): SetupSummary {
  const judged = answers.filter((a) => a.judge);
  const ok = answers.filter((a) => a.checks);
  const rules = Object.fromEntries(
    RULES.map((r) => {
      const applicable = judged.map((a) => a.judge!.rules[r]).filter((x): x is { reason: string; pass: boolean } => x !== null);
      return [r, mean(applicable.map((x) => (x.pass ? 1 : 0)))];
    }),
  );
  const pairs = answers.filter((a) => a.pair);
  return {
    setupId, answers: answers.length, errors: answers.filter((a) => a.error).length, scored: judged.length, rules,
    faithfulness: mean(answers.flatMap((a) => (a.faithfulness === null ? [] : [a.faithfulness]))),
    relevancy: mean(judged.map((a) => a.judge!.relevancy.score)),
    contextPrecision: mean(answers.flatMap((a) => (a.contextPrecision === null ? [] : [a.contextPrecision]))),
    recallAt3: mean(answers.flatMap((a) => (a.retrieval ? [a.retrieval.recallAt3 ? 1 : 0] : []))),
    mrr: mean(answers.flatMap((a) => (a.retrieval ? [a.retrieval.reciprocalRank] : []))),
    wordsMedian: median(ok.map((a) => a.checks!.words)),
    wordsMax: ok.length ? Math.max(...ok.map((a) => a.checks!.words)) : null,
    overTwoParagraphs: ok.filter((a) => a.checks!.paragraphs > 2).length,
    checked: ok.length,
    truncated: answers.filter((a) => a.truncated).length,
    tokensMean: answers.length
      ? { input: Math.round(mean(answers.map((a) => a.inputTokens))!), output: Math.round(mean(answers.map((a) => a.outputTokens))!) }
      : null,
    markdown: ok.filter((a) => a.checks!.markdown).length,
    assistantPhrases: ok.filter((a) => a.checks!.assistantPhrases.length).length,
    costPerAnswerMicros: answers.length ? Math.round(answers.reduce((s, a) => s + a.answerMicros + a.judgeMicros, 0) / answers.length) : 0,
    msMedian: median(answers.filter((a) => !a.error).map((a) => a.durationMs)),
    msMax: answers.length ? Math.max(...answers.map((a) => a.durationMs)) : null,
    pairs: pairs.length
      ? {
          wins: pairs.filter((a) => a.pair!.winner === "A").length,
          ties: pairs.filter((a) => a.pair!.winner === "tie").length,
          losses: pairs.filter((a) => a.pair!.winner === "B").length,
          baselineFirstWins: pairs.filter((a) => a.pair!.order === "baseline-first" && a.pair!.winner === "A").length,
          candidateFirstWins: pairs.filter((a) => a.pair!.order === "candidate-first" && a.pair!.winner === "A").length,
        }
      : null,
  };
}

export function summarize(r: RunResults): SetupSummary[] {
  return r.setups.map((id) => summarizeGroup(id, r.answers.filter((a) => a.setupId === id)));
}

/** A simple, printed weighting (spec §29.7 b); criteria are decided later, on the results. */
const WEIGHTS = { faithfulness: 0.3, rules: 0.3, relevancy: 0.2, length: 0.2 };
export function weighted(s: SetupSummary): number {
  const rulesMean = mean(Object.values(s.rules).filter((x): x is number => x !== null)) ?? 0;
  const lengthOk = s.checked ? 1 - s.overTwoParagraphs / s.checked : 0;
  return (s.faithfulness ?? 0) * WEIGHTS.faithfulness + rulesMean * WEIGHTS.rules + ((s.relevancy ?? 1) - 1) / 4 * WEIGHTS.relevancy + lengthOk * WEIGHTS.length;
}

export function renderReport(r: RunResults, opts: { random?: () => number; leftMicros?: number } = {}): string {
  const summaries = summarize(r);
  const out: string[] = [];
  out.push(`# Evaluation run: ${r.name}`, "");
  out.push(`Started ${r.startedAt}. Setups: ${r.setups.join(", ")}${r.baseline ? `; baseline: ${r.baseline}` : ""}. Questions: ${r.questions.length}.`);
  out.push(`Estimated ${formatDollars(r.estimateMicros)}, actual ${formatDollars(r.actualMicros)}.${opts.leftMicros === undefined ? "" : ` ${formatDollars(opts.leftMicros)} left of ${formatDollars(TOTAL_LIMIT_MICROS)}.`}`);
  out.push(`Models: ${Object.entries(r.models.agent).map(([id, m]) => `${id}: ${m}`).join("; ")}. Judge: ${r.models.judge}, reasoning off.`);
  if (r.stoppedReason) out.push(`**Stopped early:** ${r.stoppedReason}.`);
  for (const note of r.notes ?? []) out.push(`**Note:** ${note}.`);

  out.push("", "## Summary", "", "| Setup | Answers | Errors | Faithfulness | Relevancy | Ctx precision | Recall@3 | MRR | Words (median/max) | Over 2 ¶ | Markdown | Assistant phrases | Cut off | Tokens in/out (mean) | Cost/answer | Time (median/max) |", "|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|");
  for (const s of summaries) {
    out.push(`| ${s.setupId} | ${s.answers} | ${s.errors} | ${pct(s.faithfulness)} | ${num(s.relevancy, 1)} | ${pct(s.contextPrecision)} | ${pct(s.recallAt3)} | ${num(s.mrr)} | ${s.wordsMedian ?? "—"}/${s.wordsMax ?? "—"} | ${s.overTwoParagraphs} | ${s.markdown} | ${s.assistantPhrases} | ${s.truncated} | ${s.tokensMean ? `${s.tokensMean.input}/${s.tokensMean.output}` : "—"} | ${formatDollars(s.costPerAnswerMicros)} | ${s.msMedian === null ? "—" : `${(s.msMedian / 1000).toFixed(1)} s`}/${s.msMax === null ? "—" : `${(s.msMax / 1000).toFixed(1)} s`} |`);
  }
  out.push("", "| Setup | " + RULES.join(" | ") + " |", "|---|" + RULES.map(() => "---").join("|") + "|");
  for (const s of summaries) out.push(`| ${s.setupId} | ${RULES.map((rule) => pct(s.rules[rule])).join(" | ")} |`);

  out.push("", "## Per category", "");
  const categories = [...new Set(r.answers.map((a) => a.category))];
  out.push("| Setup | Category | Answers | Faithfulness | Rules passed | Over 2 ¶ |", "|---|---|---|---|---|---|");
  for (const setupId of r.setups) {
    for (const c of categories) {
      const s = summarizeGroup(setupId, r.answers.filter((a) => a.setupId === setupId && a.category === c));
      if (!s.answers) continue;
      out.push(`| ${setupId} | ${c} | ${s.answers} | ${pct(s.faithfulness)} | ${pct(mean(Object.values(s.rules).filter((x): x is number => x !== null)))} | ${s.overTwoParagraphs} |`);
    }
  }

  out.push("", "## Rankings", "", "Criteria are decided later; these views are for discussion (spec §29.7).", "");
  const base = r.baseline ? summaries.find((s) => s.setupId === r.baseline) : undefined;
  const gate = (s: SetupSummary) => !base || HARD_RULES.every((h) => (s.rules[h] ?? 1) >= (base.rules[h] ?? 1)) && s.errors <= base.errors;
  const byWins = summaries.filter(gate).sort((a, b) => (b.pairs?.wins ?? 0) - (a.pairs?.wins ?? 0));
  out.push("**(a) Hard rules as a gate, then side-by-side wins:** " + (byWins.map((s) => `${s.setupId} (${s.pairs ? `${s.pairs.wins}W/${s.pairs.ties}T/${s.pairs.losses}L` : "no pairs"})`).join(", ") || "none pass the gate"));
  out.push(`**(b) Weighted score** (faithfulness ${WEIGHTS.faithfulness}, rules ${WEIGHTS.rules}, relevancy ${WEIGHTS.relevancy}, length ${WEIGHTS.length}): ` + [...summaries].sort((a, b) => weighted(b) - weighted(a)).map((s) => `${s.setupId} ${weighted(s).toFixed(2)}`).join(", "));
  const asGood = summaries.filter((s) => gate(s) && (!base || (s.faithfulness ?? 0) >= (base.faithfulness ?? 0)));
  out.push("**(c) Cheapest at least as good as the baseline:** " + (asGood.sort((a, b) => a.costPerAnswerMicros - b.costPerAnswerMicros).map((s) => `${s.setupId} ${formatDollars(s.costPerAnswerMicros)}`).join(", ") || "none"));
  for (const s of summaries) {
    if (s.pairs) out.push(`Position lean for ${s.setupId}: wins when shown first ${s.pairs.candidateFirstWins}, when shown second ${s.pairs.baselineFirstWins}.`);
  }

  const failedRules = (a: ScoredAnswer) => (a.judge ? RULES.filter((rule) => a.judge!.rules[rule]?.pass === false) : []);
  out.push("", "## Worst answers", "");
  const worst = r.answers.filter((a) => a.judge).sort((a, b) => failedRules(b).length - failedRules(a).length || (a.faithfulness ?? 1) - (b.faithfulness ?? 1)).slice(0, 8);
  for (const a of worst) {
    out.push(`### ${a.setupId} · ${a.questionId} (${a.category})`, "", `> ${(a.text ?? "").replace(/\n/g, "\n> ")}`, "");
    for (const rule of failedRules(a)) out.push(`- ${rule}: ${a.judge!.rules[rule]!.reason}`);
    out.push(`- faithfulness: ${pct(a.faithfulness)}`, "");
  }

  out.push("## Spot-check", "", "Mark each: do you agree with the judge?", "");
  const pool = [...r.answers.filter((a) => a.judge)];
  const rand = opts.random ?? Math.random;
  for (let i = 0; i < 10 && pool.length; i++) {
    const a = pool.splice(Math.floor(rand() * pool.length), 1)[0];
    out.push(`### ${a.setupId} · ${a.questionId}`, "", `> ${(a.text ?? "").replace(/\n/g, "\n> ")}`, "");
    for (const rule of RULES) {
      const x = a.judge!.rules[rule];
      if (x) out.push(`- ${rule}: ${x.reason} → ${x.pass ? "pass" : "fail"}`);
    }
    out.push(`- faithfulness ${pct(a.faithfulness)}, relevancy ${a.judge!.relevancy.score}`, "", "[ ] agree [ ] disagree", "");
  }

  out.push("## Caveats", "");
  out.push(`- Lookups replayed in ${r.answers.filter((a) => a.lookups === "replay").length} of ${r.answers.length} answers: served by tool and call order, an approximation for prompt variants.`);
  out.push("- In a replay, extra lookups beyond the recording show as FAILED in the judge's evidence (\"No more results\"), and the persona sees them as failed searches.");
  out.push("- Replayed times leave out the lookups' own time: compare time only between live setups, or only between replayed ones.");
  out.push("- A question's earlier turns (its history) get no classifier reading: the persona sees them, the visit state counts them as plain turns.");
  out.push(`- Judge: ${r.models.judge}, reasoning off, priced from its own calls (an estimate per call when pricing failed).`);
  const unscored = r.answers.filter((a) => a.judgeError);
  if (unscored.length) out.push(`- Not scored (judge failed): ${unscored.map((a) => `${a.setupId}/${a.questionId}`).join(", ")}.`);
  const unpaired = r.answers.filter((a) => a.pairError);
  if (unpaired.length) out.push(`- Side-by-side failed: ${unpaired.map((a) => `${a.setupId}/${a.questionId}`).join(", ")}.`);
  const errors = r.answers.filter((a) => a.error);
  if (errors.length) out.push(`- Errors: ${errors.map((a) => `${a.setupId}/${a.questionId} (${a.error})`).join(", ")}.`);
  return `${out.join("\n")}\n`;
}
