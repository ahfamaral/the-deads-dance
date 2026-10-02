import { describe, expect, it } from "vitest";
import { MAX_LAG_SECONDS, nextReveal, REVEAL_CHARS_PER_SECOND } from "@/lib/reveal";

describe("nextReveal", () => {
  it("reveals at the base rate when close behind", () => {
    expect(nextReveal(0, 20, 250)).toBeCloseTo(REVEAL_CHARS_PER_SECOND * 0.25);
  });

  it("never passes what has arrived", () => {
    expect(nextReveal(18, 20, 1_000)).toBe(20);
    expect(nextReveal(25, 20, 16)).toBe(20);
  });

  it("speeds up when the lag exceeds the limit, so the gap shrinks", () => {
    const limit = REVEAL_CHARS_PER_SECOND * MAX_LAG_SECONDS; // 60 chars
    const behind = 600;
    const step = nextReveal(0, behind, 100);
    expect(step).toBeGreaterThan(REVEAL_CHARS_PER_SECOND * 0.1);
    // At this rate the backlog clears within about MAX_LAG_SECONDS.
    expect((behind / step) * 0.1).toBeLessThanOrEqual(MAX_LAG_SECONDS + 0.01);
    expect(limit).toBe(60);
  });

  it("stays put with no time elapsed", () => {
    expect(nextReveal(5, 20, 0)).toBe(5);
  });
});
