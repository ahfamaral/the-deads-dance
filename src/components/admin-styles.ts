import { formatDollars } from "@/lib/money";

/**
 * Spec §34.4–§34.8: the admin persona pages' shared look: white/5 cards, rounded-2xl, 44 px tap
 * targets and 16 px labels on phones (14 px from sm up).
 */
export const CARD = "rounded-2xl border border-white/10 bg-white/5 p-4";
export const H2 = "mb-2 text-lg font-semibold";
export const BODY = "text-base text-neutral-200 sm:text-sm";
export const MUTED = "text-base text-neutral-400 sm:text-sm";
export const BTN =
  "inline-flex min-h-11 items-center justify-center whitespace-nowrap rounded-full border border-white/15 px-4 text-base text-neutral-200 hover:bg-white/10 disabled:opacity-40 sm:text-sm";
export const BTN_PRIMARY =
  "inline-flex min-h-11 items-center justify-center whitespace-nowrap rounded-full bg-neutral-100 px-4 text-base font-semibold text-neutral-900 hover:bg-white disabled:opacity-40 sm:text-sm";
export const ROW = "flex justify-between gap-3 border-t border-white/10 py-2 first:border-t-0";
export const ALERT = "text-base text-red-300 sm:text-sm";
export const TAG = "text-sm text-lime-400";
/** "In use now", "new": what changes against the memory today. */
export const TAG_CHANGE = "text-sm text-amber-300";

/** Spec §34.5: every estimate shown is prefixed "about" (buttons excepted). */
export const about = (micros: number) => `about ${formatDollars(micros)}`;
