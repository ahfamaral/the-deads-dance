/** Spec §26.5: the energy bar's levels and banners. Browser-safe; no money here. */
export type Threshold = 100 | 50 | 20 | 10 | 0;
export type BannerThreshold = Exclude<Threshold, 100>;
export type EnergyLevel = "green" | "yellow" | "red" | "darkred" | "empty";

const THRESHOLDS: readonly Threshold[] = [100, 50, 20, 10, 0];
export const isThreshold = (v: unknown): v is Threshold => THRESHOLDS.includes(v as Threshold);

/** The share of the last full bar that's left: 0 when overdrawn or never granted, at most 1. */
export function energyLeft(balance: number, full: number): number {
  if (full <= 0 || balance <= 0) return 0;
  return Math.min(1, balance / full);
}

export function levelOf(left: number): EnergyLevel {
  if (left <= 0) return "empty";
  if (left <= 0.1) return "darkred";
  if (left <= 0.2) return "red";
  if (left <= 0.5) return "yellow";
  return "green";
}

export const percentLeft = (left: number) => Math.round(left * 100);

/** The deepest threshold the bar has reached; exactly 50%, 20% or 10% counts as reached. */
export function crossedThreshold(left: number): Threshold {
  if (left <= 0) return 0;
  if (left <= 0.1) return 10;
  if (left <= 0.2) return 20;
  if (left <= 0.5) return 50;
  return 100;
}

/** One banner at a time: the deepest crossed threshold the tester hasn't closed yet. */
export function dueBanner(left: number, warningRead: Threshold): BannerThreshold | null {
  const crossed = crossedThreshold(left);
  return crossed !== 100 && crossed < warningRead ? crossed : null;
}

export const BANNER: Record<BannerThreshold, string> = {
  50: "Half your energy is used.",
  20: "Your energy is running low: under 20% left.",
  10: "Almost out of energy: under 10% left.",
  0: "You're out of energy. Ask the admin for more.",
};
