import { z } from "zod";
import { OPENROUTER_BASE_URL } from "@corpus/embeddings";
import type { KeyCredit } from "@/lib/admin-spend";

const CACHE_MS = 60_000;
const KEY_TIMEOUT_MS = 5_000;
const KeySchema = z.object({
  data: z.object({
    limit: z.number().nullish(),
    limit_remaining: z.number().nullish(),
    usage_daily: z.number().nullish(),
    usage_weekly: z.number().nullish(),
    usage_monthly: z.number().nullish(),
  }),
});
const micros = (d: number | null | undefined) => Math.round((d ?? 0) * 1_000_000);

/** Spec §26.6: GET /api/v1/key with the app's own key, cached a minute. null when it can't be read. */
export function keyCreditWith(
  fetchImpl: typeof fetch = fetch,
  now: () => number = Date.now,
  apiKey: () => string | undefined = () => process.env.OPENROUTER_API_KEY,
  timeoutMs: number = KEY_TIMEOUT_MS,
): () => Promise<KeyCredit | null> {
  let cache: { at: number; value: KeyCredit | null } | null = null;
  return async () => {
    if (cache && now() - cache.at < CACHE_MS) return cache.value;
    let value: KeyCredit | null = null;
    try {
      const key = apiKey();
      if (!key) throw new Error("OPENROUTER_API_KEY is not set.");
      const res = await fetchImpl(`${OPENROUTER_BASE_URL}/key`, { headers: { Authorization: `Bearer ${key}` }, signal: AbortSignal.timeout(timeoutMs) });
      if (!res.ok) throw new Error(`OpenRouter /key: HTTP ${res.status}`);
      const d = KeySchema.parse(await res.json()).data;
      value = {
        limit: d.limit == null ? null : micros(d.limit),
        remaining: d.limit_remaining == null ? null : micros(d.limit_remaining),
        billed: { today: micros(d.usage_daily), week: micros(d.usage_weekly), month: micros(d.usage_monthly) },
      };
    } catch (err) {
      console.error("Couldn't check OpenRouter credit.", err);
    }
    cache = { at: now(), value };
    return value;
  };
}

export const keyCredit = keyCreditWith();
