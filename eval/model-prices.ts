import { z } from "zod";
import { OPENROUTER_BASE_URL } from "@corpus/embeddings";

/** Micro-dollars per token. */
export type ModelPrice = { prompt: number; completion: number };

/**
 * The model the estimates are measured on: REFERENCE_TOKENS and budget.json's live-answer cost come from v4-pro runs.
 * Fixed, not the app's model, so switching the app (to Haiku in Phase 5) doesn't rescale every estimate.
 */
export const PRICE_REFERENCE = "deepseek/deepseek-v4-pro";

/** The baseline's mean tokens per answer on v4-pro (eval/runs/2026-10-08-17-39-baseline-v0). */
export const REFERENCE_TOKENS = { input: 9_119, output: 2_221 };

const ListSchema = z.object({ data: z.array(z.object({ id: z.string(), pricing: z.object({ prompt: z.string(), completion: z.string() }).partial().optional() })) });
const perToken = (dollars: string | undefined) => Number(dollars ?? 0) * 1_000_000;

export async function fetchModelPrices(fetchImpl: typeof fetch = fetch): Promise<Map<string, ModelPrice>> {
  const res = await fetchImpl(`${OPENROUTER_BASE_URL}/models`, { signal: AbortSignal.timeout(10_000) });
  if (!res.ok) throw new Error(`OpenRouter models list: HTTP ${res.status}`);
  const { data } = ListSchema.parse(await res.json());
  return new Map(data.map((m) => [m.id, { prompt: perToken(m.pricing?.prompt), completion: perToken(m.pricing?.completion) }]));
}

/** Spec §30.6: what a baseline-sized answer costs on `model`, as a share of the same answer on the reference. */
export function priceScale(prices: Map<string, ModelPrice>, model: string, reference: string = PRICE_REFERENCE): number {
  const cost = (id: string) => {
    const p = prices.get(id);
    if (!p) throw new Error(`${id} is not on OpenRouter's price list; check the id before spending.`);
    return REFERENCE_TOKENS.input * p.prompt + REFERENCE_TOKENS.output * p.completion;
  };
  return cost(model) / cost(reference);
}

export function describeModels(rows: { setupId: string; model: string; scale: number }[]): string {
  return `Models: ${rows.map((r) => `${r.setupId} ${r.model} (×${r.scale.toFixed(2)} v4-pro's price per answer)`).join("; ")}`;
}
