import { describe, expect, it } from "vitest";
import { BANNER, crossedThreshold, dueBanner, energyLeft, isThreshold, levelOf, percentLeft } from "@/lib/energy";

describe("energyLeft", () => {
  it("is the share of the last full bar", () => {
    expect(energyLeft(180_000, 1_000_000)).toBe(0.18);
  });
  it("is 0, never NaN, when nothing was ever granted (Review Focus 1)", () => {
    expect(energyLeft(0, 0)).toBe(0);
    expect(energyLeft(-20_000, 0)).toBe(0);
  });
  it("is 0 when overdrawn, and at most 1", () => {
    expect(energyLeft(-20_000, 1_000_000)).toBe(0);
    expect(energyLeft(2_000_000, 1_000_000)).toBe(1);
  });
});

describe("levelOf (spec §26.5)", () => {
  it.each([
    [0.7, "green"],
    [0.51, "green"],
    [0.5, "yellow"],
    [0.21, "yellow"],
    [0.2, "red"],
    [0.11, "red"],
    [0.1, "darkred"],
    [0.01, "darkred"],
    [0, "empty"],
  ])("%f → %s", (left, level) => {
    expect(levelOf(left)).toBe(level);
  });
});

describe("banners", () => {
  it("crosses at exactly 50, 20 and 10", () => {
    expect(crossedThreshold(0.51)).toBe(100);
    expect(crossedThreshold(0.5)).toBe(50);
    expect(crossedThreshold(0.2)).toBe(20);
    expect(crossedThreshold(0.1)).toBe(10);
    expect(crossedThreshold(0)).toBe(0);
  });
  it("shows only the deepest crossed threshold not yet read", () => {
    expect(dueBanner(0.15, 100)).toBe(20); // 60% → 15% in one turn: only the 20% banner
    expect(dueBanner(0.15, 20)).toBeNull();
    expect(dueBanner(0.05, 20)).toBe(10);
    expect(dueBanner(0.7, 100)).toBeNull();
    expect(dueBanner(0, 10)).toBe(0);
  });
  it("words each banner without money", () => {
    expect(Object.values(BANNER).join(" ")).not.toMatch(/\$|month|dollar|cost/i);
    expect(BANNER[0]).toBe("You're out of energy. Ask the admin for more.");
  });
  it("rounds the percentage and knows a threshold", () => {
    expect(percentLeft(0.184)).toBe(18);
    expect(isThreshold(20)).toBe(true);
    expect(isThreshold(30)).toBe(false);
  });
});
