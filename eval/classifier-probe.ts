import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { BaseCallbackHandler } from "@langchain/core/callbacks/base";
import type { LLMResult } from "@langchain/core/outputs";
import { z } from "zod";
import { CostLedger } from "@corpus/cost-ledger";
import { OPENROUTER_BASE_URL } from "@corpus/embeddings";
import { chatModel, type ReasoningEffort } from "@corpus/models";
import { CharacterProfileSchema, type CharacterProfile } from "@corpus/profile";
import { CLASSIFIER_PROMPT, CLASSIFIER_TIMEOUT_MS, classifyVisitorWith } from "@/lib/server/visitor-classifier";
import { VISITOR_ACTS, WANTS, type VisitorAct } from "@/lib/visitor-act";
import { checkLimits, describeEstimate, formatDollars, readBudget, runLimitMicros, withRun, writeBudget } from "./budget";
import { fetchModelPrices, isFixedPrice, type ModelPrice } from "./model-prices";

/**
 * Offline probe (asked 2026-10-19): the visitor classifier's prompt and schema on labelled messages, the app's
 * helper (v4.1-flash) against TypeSafe's Jev Router. Not part of the live app. Same habits as eval/cli.ts:
 * a dry run spends nothing; --confirm only after "banana" in chat; budget.json is updated after every call.
 */
const CASES = "eval/classifier-cases.json";
const BUDGET = "eval/budget.json";

/** Longer than the live 10 s, so slow answers are measured rather than cut; over 10 s counts as a live miss. */
export const PROBE_TIMEOUT_MS = 30_000;
/** A variable-price router's worst call stays bounded: the classifier's JSON is under 100 tokens, plus room to reason. */
export const PROBE_MAX_TOKENS = 1_000;
/** For a fixed price's estimate: the system prompt and tags, and a generous reply. */
const EST_TOKENS = { input: Math.ceil(CLASSIFIER_PROMPT.length / 4) + 200, output: 150 };

export type ProbeModel = { id: string; model: string; reasoningEffort?: ReasoningEffort; describe: string };
export const PROBE_MODELS: ProbeModel[] = [
  { id: "flash", model: "deepseek/deepseek-v4.1-flash", reasoningEffort: "none", describe: "the app's classifier today, reasoning off" },
  // No reasoning setting: picking the model and its effort is what the router is for.
  { id: "jev", model: "typesafe/jev-router", describe: "TypeSafe Jev Router, its own model and effort" },
];

const accept = <T extends z.ZodType>(t: T) => z.union([t, z.array(t).min(1)]);
const ExpectSchema = z.strictObject({
  act: accept(z.enum(VISITOR_ACTS)),
  offense: accept(z.number().int().min(0).max(3)),
  sorePoint: accept(z.boolean()),
  language: accept(z.string().regex(/^([a-z]{2}|und)$/)),
  wants: accept(z.enum(WANTS)),
  visitorName: accept(z.string().nullable()),
});
export const FIELDS = ["act", "offense", "sorePoint", "language", "wants", "visitorName"] as const;
export type Field = (typeof FIELDS)[number];

export const CaseSchema = z.strictObject({
  id: z.string().min(1),
  persona: z.string().min(1),
  personaSaid: z.string().nullable(),
  visitor: z.string().min(1),
  expect: ExpectSchema,
});
export type ProbeCase = z.infer<typeof CaseSchema>;

export function loadCases(path = CASES): ProbeCase[] {
  const cases = z.array(CaseSchema).parse(JSON.parse(readFileSync(path, "utf8")));
  const ids = new Set<string>();
  for (const c of cases) {
    if (ids.has(c.id)) throw new Error(`Duplicate case id ${c.id}.`);
    ids.add(c.id);
  }
  return cases;
}

export function loadProfiles(path = "personas.json"): Map<string, CharacterProfile> {
  const list = z.array(z.object({ slug: z.string(), profile: CharacterProfileSchema })).parse(JSON.parse(readFileSync(path, "utf8")));
  return new Map(list.map((p) => [p.slug, p.profile]));
}

/** Each field is right when the answer is one of the labels the case accepts; a null act (invalid or timed out) gets nothing right. */
export function scoreCase(expect: ProbeCase["expect"], actual: VisitorAct | null): Record<Field, boolean> & { all: boolean } {
  const right = Object.fromEntries(
    FIELDS.map((f) => {
      const ok = ([] as unknown[]).concat(expect[f]);
      return [f, actual !== null && ok.includes(actual[f])];
    }),
  ) as Record<Field, boolean>;
  return { ...right, all: FIELDS.every((f) => right[f]) };
}

export function parseArgs(argv: string[]): { models: string; cases: string; cap: number; name: string; confirm: boolean } {
  const out = { models: "flash,jev", cases: "all", cap: 0.25, name: "classifier-probe", confirm: false };
  for (let i = 0; i < argv.length; i += 2) {
    const [flag, value] = [argv[i], argv[i + 1]];
    if (flag === "--confirm") {
      out.confirm = true;
      i--; // takes no value
    } else if (flag === "--models") out.models = value;
    else if (flag === "--cases") out.cases = value;
    else if (flag === "--cap") {
      out.cap = Number(value);
      if (!Number.isFinite(out.cap) || out.cap <= 0) throw new Error("--cap takes a positive number of dollars, such as 0.25.");
    } else if (flag === "--name") out.name = value;
    else throw new Error(`Unknown option ${flag}. Use --models, --cases, --cap, --name, --confirm.`);
  }
  return out;
}

/** Fixed prices are estimated from tokens; a variable price is planned at its cap, which the run enforces on real spend. */
export function planMicros(models: ProbeModel[], cases: number, prices: Map<string, ModelPrice>, capMicros: number): { estimate: number; lines: string[] } {
  let estimate = 0;
  const lines = models.map((m) => {
    const price = prices.get(m.model);
    if (!price) throw new Error(`${m.model} is not on OpenRouter's price list; check the id before spending.`);
    if (isFixedPrice(price)) {
      const micros = Math.round(cases * (EST_TOKENS.input * price.prompt + EST_TOKENS.output * price.completion));
      estimate += micros;
      return `${m.id} ${m.model} (${m.describe}): about ${formatDollars(micros)} for ${cases} calls.`;
    }
    estimate += capMicros;
    return `${m.id} ${m.model} (${m.describe}): no fixed price; capped at ${formatDollars(capMicros)} of real spend, ${PROBE_MAX_TOKENS} tokens per call.`;
  });
  return { estimate, lines };
}

export type CallRecord = {
  caseId: string;
  modelId: string;
  act: VisitorAct | null;
  score: ReturnType<typeof scoreCase>;
  latencyMs: number;
  overLive: boolean;
  costMicros: number | null;
  routedModel: string | null;
  provider: string | null;
  reasoningTokens: number | null;
  generationId: string | null;
};

/** The model that actually answered: a router names it in the response, not in the request. */
class RoutedModel extends BaseCallbackHandler {
  name = "routed-model";
  model: string | null = null;
  reasoningTokens: number | null = null;
  constructor() {
    super({ _awaitHandler: true });
  }
  async handleLLMEnd(output: LLMResult) {
    const message = (output.generations[0]?.[0] as { message?: { response_metadata?: Record<string, unknown>; usage_metadata?: { output_token_details?: { reasoning?: number } } } } | undefined)?.message;
    const meta = message?.response_metadata ?? {};
    const named = meta.model_name ?? meta.model;
    this.model = typeof named === "string" ? named : null;
    this.reasoningTokens = message?.usage_metadata?.output_token_details?.reasoning ?? null;
  }
}

/** OpenRouter's record of a generation: the routed model and provider, and the billed cost. Best effort; free. */
async function lookupGeneration(id: string): Promise<{ model: string | null; provider: string | null; costMicros: number | null } | null> {
  for (const wait of [1_500, 4_000]) {
    await new Promise((r) => setTimeout(r, wait));
    try {
      const res = await fetch(`${OPENROUTER_BASE_URL}/generation?id=${encodeURIComponent(id)}`, {
        headers: { Authorization: `Bearer ${process.env.OPENROUTER_API_KEY}` },
        signal: AbortSignal.timeout(10_000),
      });
      if (!res.ok) continue;
      const data = ((await res.json()) as { data?: { model?: unknown; provider_name?: unknown; total_cost?: unknown } }).data;
      return {
        model: typeof data?.model === "string" ? data.model : null,
        provider: typeof data?.provider_name === "string" ? data.provider_name : null,
        costMicros: typeof data?.total_cost === "number" && data.total_cost >= 0 ? Math.round(data.total_cost * 1_000_000) : null,
      };
    } catch {
      // try once more, then go without
    }
  }
  return null;
}

const pct = (n: number, d: number) => (d ? `${Math.round((100 * n) / d)}%` : "–");
const median = (xs: number[]) => {
  const s = [...xs].sort((a, b) => a - b);
  return s.length ? s[Math.floor(s.length / 2)] : 0;
};

export function renderReport(name: string, models: ProbeModel[], cases: ProbeCase[], calls: CallRecord[]): string {
  const out = [`# Classifier probe: ${name}`, "", `${cases.length} labelled cases (${CASES}). A field is right when it matches one of the case's accepted labels.`, ""];
  out.push(`| Model | Calls | Valid | All fields | ${FIELDS.join(" | ")} | Over 10 s | Median ms | Max ms | Cost | Per call |`);
  out.push(`|---|---|---|---|${FIELDS.map(() => "---").join("|")}|---|---|---|---|---|`);
  for (const m of models) {
    const mine = calls.filter((c) => c.modelId === m.id);
    const n = mine.length;
    const cost = mine.reduce((s, c) => s + (c.costMicros ?? 0), 0);
    out.push(
      `| ${m.id} | ${n} | ${pct(mine.filter((c) => c.act).length, n)} | ${pct(mine.filter((c) => c.score.all).length, n)} | ${FIELDS.map((f) => pct(mine.filter((c) => c.score[f]).length, n)).join(" | ")} | ${mine.filter((c) => c.overLive).length} | ${median(mine.map((c) => c.latencyMs))} | ${Math.max(0, ...mine.map((c) => c.latencyMs))} | ${formatDollars(cost)} | ${n ? formatDollars(Math.round(cost / n)) : "–"} |`,
    );
  }
  const routed = calls.filter((c) => c.modelId === "jev");
  if (routed.length) {
    out.push("", "## What Jev picked", "", "| Case | Expected act | Routed model | Provider | Reasoning tokens | ms | Cost |", "|---|---|---|---|---|---|---|");
    for (const c of routed) {
      const expected = ([] as string[]).concat(cases.find((k) => k.id === c.caseId)!.expect.act).join("/");
      out.push(`| ${c.caseId} | ${expected} | ${c.routedModel ?? "?"} | ${c.provider ?? "?"} | ${c.reasoningTokens ?? "?"} | ${c.latencyMs} | ${c.costMicros === null ? "?" : formatDollars(c.costMicros)} |`);
    }
  }
  out.push("", "## Misses", "", "| Model | Case | Field | Expected | Got |", "|---|---|---|---|---|");
  for (const c of calls) {
    const k = cases.find((x) => x.id === c.caseId)!;
    if (!c.act) out.push(`| ${c.modelId} | ${c.caseId} | (all) | | ${c.overLive && c.latencyMs >= PROBE_TIMEOUT_MS ? "timed out" : "invalid or failed"} |`);
    else for (const f of FIELDS) if (!c.score[f]) out.push(`| ${c.modelId} | ${c.caseId} | ${f} | ${JSON.stringify(k.expect[f])} | ${JSON.stringify(c.act[f])} |`);
  }
  return `${out.join("\n")}\n`;
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  const wanted = args.models.split(",").map((s) => s.trim());
  const models = wanted.map((id) => {
    const m = PROBE_MODELS.find((p) => p.id === id);
    if (!m) throw new Error(`Unknown model ${id}. Known: ${PROBE_MODELS.map((p) => p.id).join(", ")}.`);
    return m;
  });
  const all = loadCases();
  const cases = args.cases === "all" ? all : args.cases.split(",").map((id) => all.find((c) => c.id === id.trim()) ?? (() => { throw new Error(`Unknown case ${id}.`); })());
  const profiles = loadProfiles();
  for (const c of cases) if (!profiles.has(c.persona)) throw new Error(`Case ${c.id}: no persona ${c.persona} in personas.json.`);

  const budget = readBudget(BUDGET);
  const spent = budget?.spentMicros ?? 0;
  const capMicros = Math.round(args.cap * 1_000_000);
  const prices = await fetchModelPrices();
  const { estimate, lines } = planMicros(models, cases.length, prices, capMicros);
  for (const line of lines) console.log(line);
  const refusal = checkLimits(estimate, spent);
  if (refusal) throw new Error(refusal);
  console.log(describeEstimate({ estimate, spent, creating: budget === null, confirmed: args.confirm }));
  if (!args.confirm) return;

  const startedAt = new Date().toISOString();
  const runLimit = runLimitMicros(spent);
  const spendBy = new Map(models.map((m) => [m.id, 0]));
  const stopped = new Set<string>();
  const saveSpend = () => writeBudget(BUDGET, withRun(budget, { name: args.name, at: startedAt, micros: [...spendBy.values()].reduce((s, n) => s + n, 0) }));
  const calls: CallRecord[] = [];

  // Models interleaved per case, so a capped router stopping early doesn't cost the baseline its cases.
  for (const c of cases) {
    for (const m of models) {
      if (stopped.has(m.id)) continue;
      const fixed = isFixedPrice(prices.get(m.model));
      const ledger = new CostLedger();
      const routed = new RoutedModel();
      const classify = classifyVisitorWith(
        chatModel("helper", { model: m.model, timeout: PROBE_TIMEOUT_MS, maxRetries: 0, reasoningEffort: m.reasoningEffort, maxTokens: PROBE_MAX_TOKENS }),
        { timeoutMs: PROBE_TIMEOUT_MS },
      );
      const t0 = Date.now();
      const act = await classify({ personaMessage: c.personaSaid, visitorMessage: c.visitor, profile: profiles.get(c.persona)!, callbacks: [ledger.handler("classifier"), routed] });
      const latencyMs = Date.now() - t0;
      const call = ledger.calls[0];
      let costMicros = call?.cost ?? null;
      let provider: string | null = null;
      let routedModel = routed.model;
      if (!fixed && call?.generationId) {
        const gen = await lookupGeneration(call.generationId);
        provider = gen?.provider ?? null;
        routedModel = gen?.model ?? routedModel;
        costMicros ??= gen?.costMicros ?? null;
      }
      if (costMicros === null && call && fixed) {
        const p = prices.get(m.model)!;
        costMicros = Math.round(call.inputTokens * p.prompt + call.outputTokens * p.completion);
      }
      spendBy.set(m.id, spendBy.get(m.id)! + (costMicros ?? 0));
      saveSpend();
      calls.push({ caseId: c.id, modelId: m.id, act, score: scoreCase(c.expect, act), latencyMs, overLive: latencyMs > CLASSIFIER_TIMEOUT_MS, costMicros, routedModel, provider, reasoningTokens: routed.reasoningTokens, generationId: call?.generationId ?? null });
      console.log(`${c.id} ${m.id}: ${act ? `${act.act}/${act.offense}/${act.wants}/${act.language}` : "no answer"} in ${latencyMs} ms, ${costMicros === null ? "cost unknown" : formatDollars(costMicros)}${routedModel && !fixed ? ` via ${routedModel}` : ""}`);
      if (!fixed && call && costMicros === null) {
        console.log(`Stopping ${m.id}: its cost couldn't be read, so the cap can't be enforced.`);
        stopped.add(m.id);
      } else if (!fixed && spendBy.get(m.id)! >= capMicros) {
        console.log(`Stopping ${m.id}: it reached its ${formatDollars(capMicros)} cap.`);
        stopped.add(m.id);
      }
      if ([...spendBy.values()].reduce((s, n) => s + n, 0) >= runLimit) {
        console.log(`Stopping the run: it reached the ${formatDollars(runLimit)} run limit.`);
        models.forEach((x) => stopped.add(x.id));
      }
    }
  }

  const stamp = startedAt.slice(0, 16).replace(/[:T]/g, "-");
  const dir = join("eval/runs", `${stamp}-${args.name}`);
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, "classifier-results.json"), `${JSON.stringify({ name: args.name, startedAt, models, calls }, null, 2)}\n`);
  writeFileSync(join(dir, "report.md"), renderReport(args.name, models, cases, calls));
  console.log(`Spent ${formatDollars([...spendBy.values()].reduce((s, n) => s + n, 0))}. Report: ${join(dir, "report.md")}`);
}

if (process.argv[1]?.endsWith("classifier-probe.ts")) {
  main()
    .catch((err) => {
      console.error(err instanceof Error ? err.message : err);
      process.exitCode = 1;
    })
    .finally(() => process.exit(process.exitCode ?? 0));
}
