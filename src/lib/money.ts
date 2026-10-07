/**
 * Spec §26.2: money is integer micro-dollars ($1 = 1,000,000). Browser-safe. Only admin screens
 * format money: testers never see it.
 */
export const MICROS_PER_DOLLAR = 1_000_000;
/** Spec §26.1: a grant or the starting energy is $0.01 to $5.00. */
export const MIN_GRANT = 10_000;
export const MAX_GRANT = 5_000_000;
export const DEFAULT_STARTING_ENERGY = 1_000_000;

/** "1", "1.5", "0.25" (or a number) → micro-dollars; null unless $0.01–$5.00 with at most two decimals. */
export function parseGrant(input: unknown): number | null {
  const text = typeof input === "number" ? String(input) : typeof input === "string" ? input.trim() : "";
  if (!/^\d+(\.\d{1,2})?$/.test(text)) return null;
  const micros = Math.round(Number(text) * 100) * 10_000;
  return micros >= MIN_GRANT && micros <= MAX_GRANT ? micros : null;
}

/** Cents when that's exact; otherwise enough decimals to show a small cost ($0.031, $0.0009). */
export function formatDollars(micros: number): string {
  const sign = micros < 0 ? "−" : "";
  const abs = Math.abs(micros);
  const decimals = abs % 10_000 === 0 ? 2 : abs < 1_000 ? 4 : 3;
  return `${sign}$${(abs / MICROS_PER_DOLLAR).toFixed(decimals)}`;
}

export function formatTokens(n: number): string {
  if (n < 1_000) return `${n} tok`;
  return n < 10_000 ? `${(n / 1_000).toFixed(1)}k tok` : `${Math.round(n / 1_000)}k tok`;
}

export const spendLabel = (s: { tokens: number; cost: number }) => `${formatTokens(s.tokens)} · ${formatDollars(s.cost)}`;
