import { describe, expect, it } from "vitest";
import { shouldWarnBeforeLeaving, showEndBar } from "@/lib/leave-guard";

describe("shouldWarnBeforeLeaving", () => {
  it("warns only for an ended, unsaved, live conversation", () => {
    expect(shouldWarnBeforeLeaving({ ended: true, saveStatus: "idle", readOnly: false })).toBe(true);
    expect(shouldWarnBeforeLeaving({ ended: true, saveStatus: "error", readOnly: false })).toBe(true);
  });

  it("doesn't warn once saved, in a record, or while the visit is still going", () => {
    expect(shouldWarnBeforeLeaving({ ended: true, saveStatus: "saved", readOnly: false })).toBe(false);
    expect(shouldWarnBeforeLeaving({ ended: true, saveStatus: "idle", readOnly: true })).toBe(false);
    expect(shouldWarnBeforeLeaving({ ended: false, saveStatus: "idle", readOnly: false })).toBe(false);
  });
});

describe("showEndBar", () => {
  // Final review: a retry on the exit turn streams with the input (and its Stop), not under the end bar.
  it("shows the end bar only for an ended visit that isn't streaming", () => {
    expect(showEndBar({ ended: true, streaming: false })).toBe(true);
    expect(showEndBar({ ended: true, streaming: true })).toBe(false);
    expect(showEndBar({ ended: false, streaming: false })).toBe(false);
  });
});
