/** Spec §18.6: a steady human reading pace, never falling far behind the stream. */
export const REVEAL_CHARS_PER_SECOND = 40;
export const MAX_LAG_SECONDS = 1.5;

/**
 * How many characters to show after `elapsedMs`, given how many are shown and how many
 * have arrived. Fractional, so small frames accumulate; the caller floors it for display.
 * Behind by more than MAX_LAG_SECONDS of reading, the rate scales up so the backlog
 * clears within about that time.
 */
export function nextReveal(revealed: number, arrived: number, elapsedMs: number): number {
  if (revealed >= arrived) return arrived;
  const backlog = arrived - revealed;
  const limit = REVEAL_CHARS_PER_SECOND * MAX_LAG_SECONDS;
  const rate = backlog > limit ? backlog / MAX_LAG_SECONDS : REVEAL_CHARS_PER_SECOND;
  return Math.min(arrived, revealed + (rate * elapsedMs) / 1000);
}
