import { z } from "zod";
import type { ModelCallRecord } from "@corpus/cost-ledger";
import { EMBEDDING_MICROS_PER_TOKEN, EMBEDDING_MODEL, OPENROUTER_BASE_URL } from "@corpus/embeddings";

/** A call ready to store: always a cost, and where it came from (spec §26.3). */
export type ResolvedCall = Omit<ModelCallRecord, "cost"> & { cost: number; costSource: "reported" | "estimated" };

/** Micro-dollars per token. */
type Price = { prompt: number; completion: number };

const DAY_MS = 86_400_000;
const RETRY_MS = 5 * 60_000;
const PRICES_TIMEOUT_MS = 5_000;

const ModelsSchema = z.object({
  data: z.array(z.object({ id: z.string(), pricing: z.object({ prompt: z.string(), completion: z.string() }).partial().optional() })),
});

const perToken = (dollars: string | undefined) => {
  const n = Number(dollars ?? 0);
  return Number.isFinite(n) && n >= 0 ? n * 1_000_000 : 0;
};

/** Spec §26.3: a missing usage.cost is tokens × the model's price from OpenRouter's list, cached a day. */
export function pricingWith(fetchImpl: typeof fetch = fetch, now: () => number = Date.now, timeoutMs: number = PRICES_TIMEOUT_MS) {
  let cache: { until: number; prices: Map<string, Price> } | null = null;

  async function prices(): Promise<Map<string, Price>> {
    if (cache && now() < cache.until) return cache.prices;
    try {
      const res = await fetchImpl(`${OPENROUTER_BASE_URL}/models`, { signal: AbortSignal.timeout(timeoutMs) });
      if (!res.ok) throw new Error(`OpenRouter models list: HTTP ${res.status}`);
      const { data } = ModelsSchema.parse(await res.json());
      cache = {
        until: now() + DAY_MS,
        prices: new Map(data.map((m) => [m.id, { prompt: perToken(m.pricing?.prompt), completion: perToken(m.pricing?.completion) }])),
      };
    } catch (err) {
      console.error("Couldn't load model prices; unpriced calls are logged at 0.", err);
      cache = { until: now() + RETRY_MS, prices: cache?.prices ?? new Map() };
    }
    return cache.prices;
  }

  return async function resolveCosts(calls: readonly ModelCallRecord[]): Promise<ResolvedCall[]> {
    const needList = calls.some((c) => c.cost === null && c.model !== EMBEDDING_MODEL);
    const table = needList ? await prices() : new Map<string, Price>();
    return calls.map((c): ResolvedCall => {
      if (c.cost !== null) return { ...c, cost: c.cost, costSource: "reported" };
      const price = c.model === EMBEDDING_MODEL ? { prompt: EMBEDDING_MICROS_PER_TOKEN, completion: 0 } : table.get(c.model);
      const cost = price ? Math.round(c.inputTokens * price.prompt + c.outputTokens * price.completion) : 0;
      return { ...c, cost, costSource: "estimated" };
    });
  };
}

export const resolveCosts = pricingWith();
