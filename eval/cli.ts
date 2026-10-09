import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { closePool, getPool } from "@corpus/db";
import { chatModel, modelId } from "@corpus/models";
import { findPersona } from "@corpus/personas";
import { closeMcpClient, getMcpTools } from "@/lib/server/mcp-client";
import { resolveCosts } from "@/lib/server/pricing";
import { visitorClassifier } from "@/lib/server/visitor-classifier";
import { CostLedger } from "@corpus/cost-ledger";
import { checkLimits, DEFAULT_COSTS, describeEstimate, estimateMicros, readBudget, RunSpend, runLimitMicros, TOTAL_LIMIT_MICROS, withRun, writeBudget, type BudgetFile } from "./budget";
import { judgeWith } from "./judge";
import { questionKey, readRecording, writeRecording } from "./lookups";
import { loadQuestions, selectQuestions } from "./questions";
import { describeModels, fetchModelPrices, priceScale } from "./model-prices";
import { renderReport } from "./report";
import { runEval } from "./run";
import { pickSetups, preflightSetups, type Setup } from "./setups";
import type { AnswerRecord, RunResults } from "./types";

const BUDGET = "eval/budget.json";
const LOOKUPS = "eval/lookups";

export function parseArgs(argv: string[]): { setups: string; questions: string; baseline: string | null; name: string; confirm: boolean } {
  const out = { setups: "v0", questions: "screening", baseline: null as string | null, name: "run", confirm: false };
  for (let i = 0; i < argv.length; i += 2) {
    const [flag, value] = [argv[i], argv[i + 1]];
    if (flag === "--confirm") {
      out.confirm = true;
      i--; // takes no value
    } else if (flag === "--setups") out.setups = value;
    else if (flag === "--questions") out.questions = value;
    else if (flag === "--baseline") out.baseline = value;
    else if (flag === "--name") out.name = value;
    else throw new Error(`Unknown option ${flag}. Use --setups, --questions, --baseline, --name, --confirm.`);
  }
  return out;
}

/** A setup compared with a run of itself gets no side-by-side (spec §29.6 pairs a candidate with a different baseline). */
export function baselineWarning(setupIds: string[], baselineSetupId: string): string | null {
  return setupIds.includes(baselineSetupId)
    ? `Warning: ${baselineSetupId} is the baseline's own setup, so it gets no side-by-side comparison in this run.`
    : null;
}

/** The live answers that measure liveAnswer: on the app's own model only, so a model round can't skew later estimates (§30.6). */
export function measuredLiveAnswers<A extends { setupId: string; lookups: string; error: string | null }>(answers: A[], setups: Pick<Setup, "id" | "modelId">[]): A[] {
  const appModel = new Set(setups.filter((s) => !s.modelId || s.modelId === modelId("agent")).map((s) => s.id));
  return answers.filter((a) => a.lookups === "live" && !a.error && appModel.has(a.setupId));
}

/** Spec §30.4: the baseline is one setup of an earlier run: the one named after a colon, or the run's first. */
export function baselineFrom(prior: RunResults, setupId: string | null): { setupId: string; answers: Map<string, AnswerRecord> } {
  const id = setupId ?? prior.setups[0];
  if (!prior.setups.includes(id)) throw new Error(`${id} isn't in that run; it has ${prior.setups.join(", ")}.`);
  return { setupId: id, answers: new Map(prior.answers.filter((a) => a.setupId === id).map((a) => [a.questionId, a])) };
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  const setups = pickSetups(args.setups);
  preflightSetups(setups);
  const questions = selectQuestions(loadQuestions(), args.questions);
  const budget: BudgetFile | null = readBudget(BUDGET); // throws on a corrupt file (spec §29.8)
  const spent = budget?.spentMicros ?? 0;

  let baseline: { setupId: string; answers: Map<string, AnswerRecord> } | null = null;
  if (args.baseline) {
    const colon = args.baseline.lastIndexOf(":");
    const [dir, setupId] = colon > 0 ? [args.baseline.slice(0, colon), args.baseline.slice(colon + 1)] : [args.baseline, null];
    baseline = baselineFrom(JSON.parse(readFileSync(join(dir, "results.json"), "utf8")) as RunResults, setupId);
    const warning = baselineWarning(setups.map((s) => s.id), baseline.setupId);
    if (warning) console.log(warning);
  }

  // Spec §29.4: count what will run live (no recording yet, or a live setup) and what replays.
  // Spec §30.6: a live answer on another model is priced by that model's share of v4-pro's price.
  const onModels = setups.filter((s) => s.modelId);
  const prices = onModels.length ? await fetchModelPrices() : null;
  const scales = new Map(onModels.map((s) => [s.id, priceScale(prices!, s.modelId!)]));
  if (scales.size) console.log(describeModels(onModels.map((s) => ({ setupId: s.id, model: s.modelId!, scale: scales.get(s.id)! }))));
  const runs = setups.flatMap((s) => questions.map((q) => ({ setup: s, replay: s.lookups === "replay" && readRecording(LOOKUPS, q.id)?.question === questionKey(q) })));
  const replay = runs.filter((r) => r.replay).length;
  const liveOnModels = runs.filter((r) => !r.replay && scales.has(r.setup.id)).map((r) => scales.get(r.setup.id)!);
  const live = runs.length - replay - liveOnModels.length;
  const pairs = baseline ? setups.filter((s) => s.id !== baseline!.setupId).length * questions.length : 0;
  const estimate = estimateMicros({ live, replay, judged: runs.length, pairs, liveOnModels }, budget?.measured ?? {});
  const refusal = checkLimits(estimate, spent);
  if (refusal) throw new Error(refusal);

  console.log(describeEstimate({ estimate, spent, creating: budget === null, confirmed: args.confirm }));
  if (!args.confirm) return; // spec §29.4: a dry run spends nothing

  const startedAt = new Date().toISOString();
  // Spec §29.4: budget.json is rewritten after every answer, so a crash or a kill loses at most one question's spend.
  const saveSpend = (micros: number) => writeBudget(BUDGET, withRun(budget, { name: args.name, at: startedAt, micros }));
  let stop = false;
  let lastSpend = 0;
  process.on("SIGINT", () => {
    if (stop) {
      console.log("\nQuitting now. The spend so far is in eval/budget.json.");
      process.exit(130);
    }
    console.log("\nStopping after the current question… (Ctrl-C again to quit now)");
    stop = true;
  });
  // The judge's own calls are priced like the app's: through a ledger (spec §29.4, "the actual cost").
  const judgeLedger = new CostLedger();
  let judgePriced = 0;
  const priceJudge = async () => {
    const fresh = judgeLedger.calls.slice(judgePriced);
    judgePriced = judgeLedger.calls.length;
    return (await resolveCosts(fresh)).reduce((s, c) => s + c.cost, 0);
  };
  const stamp = startedAt.slice(0, 16).replace(/[:T]/g, "-");
  const dir = join("eval/runs", `${stamp}-${args.name}`);
  try {
    const results = await runEval({
      name: args.name,
      setups,
      questions,
      personaFor: (slug) => findPersona(getPool(), slug),
      deps: {
        classify: visitorClassifier(),
        liveTools: getMcpTools,
        recordingFor: (id) => readRecording(LOOKUPS, id),
        resolveCosts: async (calls) => (await resolveCosts(calls)).map((c) => ({ cost: c.cost, inputTokens: c.inputTokens, outputTokens: c.outputTokens })),
      },
      judge: judgeWith(chatModel("helper", { reasoningEffort: "none", timeout: 30_000, maxRetries: 0, callbacks: [judgeLedger.handler("helper")] })),
      baseline,
      saveRecording: (r) => writeRecording(LOOKUPS, r),
      judgeCallMicros: budget?.measured.judge ?? DEFAULT_COSTS.judge,
      estimateMicros: estimate,
      stopRequested: () => stop,
      log: (line) => console.log(line),
      spend: new RunSpend(runLimitMicros(spent)),
      onSpend: (micros) => {
        lastSpend = micros;
        saveSpend(micros);
      },
      priceJudge,
      models: { judge: modelId("helper"), agent: Object.fromEntries(setups.map((s) => [s.id, (s.agentModel() as unknown as { model: string }).model])) },
      now: () => new Date(startedAt),
    });
    // The budget first: it is the one file that must never fall behind what was spent.
    const next = withRun(budget, { name: args.name, at: startedAt, micros: results.actualMicros });
    const liveAnswers = measuredLiveAnswers(results.answers, setups);
    const replayAnswers = results.answers.filter((a) => a.lookups === "replay" && !a.error);
    if (liveAnswers.length) next.measured.liveAnswer = Math.round(liveAnswers.reduce((s, a) => s + a.answerMicros, 0) / liveAnswers.length);
    if (replayAnswers.length) next.measured.replayAnswer = Math.round(replayAnswers.reduce((s, a) => s + a.answerMicros, 0) / replayAnswers.length);
    const judged = results.answers.filter((a) => a.judgeMicros > 0);
    if (judgeLedger.calls.length && judged.length) {
      next.measured.judge = Math.max(1, Math.round(judged.reduce((s, a) => s + a.judgeMicros, 0) / judgeLedger.calls.length));
    }
    writeBudget(BUDGET, next);
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, "results.json"), `${JSON.stringify(results, null, 2)}\n`);
    writeFileSync(join(dir, "report.md"), renderReport(results, { leftMicros: TOTAL_LIMIT_MICROS - next.spentMicros }));
    console.log(`Done: ${dir}/report.md`);
  } catch (err) {
    saveSpend(lastSpend); // what onSpend last recorded; the run's results are lost, the money isn't
    throw err;
  } finally {
    await closeMcpClient();
    await closePool();
  }
}

if (process.argv[1]?.endsWith("cli.ts")) {
  main()
    .catch((err) => {
      console.error(err instanceof Error ? err.message : err);
      process.exitCode = 1;
    })
    // closeMcpClient() returns but the tsx-wrapped MCP child stays alive and holds the process open;
    // everything is saved by now, so exit (the child ends with its stdin).
    .finally(() => process.exit(process.exitCode ?? 0));
}
