// Browser-safe: the report types and the text helpers for /admin.
import type { Spend } from "@/lib/chat-types";
import { formatDollars } from "@/lib/money";

/** Spec §26.6: the OpenRouter key's credit, in micro-dollars. */
export type KeyCredit = { limit: number | null; remaining: number | null; billed: { today: number; week: number; month: number } };
export type SpendReport = { credit: KeyCredit | null; logged: { today: Spend; week: Spend; month: Spend }; held: number };

export function creditWarnings(r: SpendReport): string[] {
  if (!r.credit) return ["Couldn't check OpenRouter credit."];
  if (r.credit.limit === null) return ["The key has no credit limit. Set one on OpenRouter."];
  if (r.credit.remaining !== null && r.held > r.credit.remaining) {
    return [
      `Testers still hold ${formatDollars(r.held)} of energy, more than the ${formatDollars(r.credit.remaining)} left on the key. Raise the key limit on OpenRouter.`,
    ];
  }
  return [];
}

/** Spec §26.6: more than 5% billed but not logged points at a leak (timeouts, crashes). */
export const gapTooBig = (billed: number, logged: number) => billed > 0 && (billed - logged) / billed > 0.05;

export const addEnergyPreview = (balance: number, amount: number) =>
  `They have ${formatDollars(Math.max(balance, 0))} left. After this: ${formatDollars(balance + amount)}, and their bar is full again.`;

export function energyCell(balance: number, full: number): string {
  if (balance > 0) return `${formatDollars(balance)} of ${formatDollars(full)}`;
  return balance < 0 ? `Empty (${formatDollars(balance)})` : "Empty";
}

/** Spec §26.6: the confirmation before changing the starting energy. */
export const startingEnergyConfirm = (was: number, next: number) =>
  `New testers will get ${formatDollars(next)} when approved (was ${formatDollars(was)}). Testers already approved keep their energy.`;
