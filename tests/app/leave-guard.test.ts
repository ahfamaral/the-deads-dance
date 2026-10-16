import { describe, expect, it } from "vitest";
import { confirmBeforeLeaving, shouldAskForRating, showEndBar } from "@/lib/leave-guard";

describe("showEndBar", () => {
  // Final review: a retry on the exit turn streams with the input (and its Stop), not under the end bar.
  it("shows the end bar only for an ended visit that isn't streaming", () => {
    expect(showEndBar({ ended: true, streaming: false })).toBe(true);
    expect(showEndBar({ ended: true, streaming: true })).toBe(false);
    expect(showEndBar({ ended: false, streaming: false })).toBe(false);
  });
});

describe("confirmBeforeLeaving (spec §25.5)", () => {
  const live = { readOnly: false, ended: false, gone: false, hasMessages: true };

  // Leaving freezes the conversation: it reopens only from History, read-only.
  it("asks before leaving a conversation that is still going", () => {
    expect(confirmBeforeLeaving(live)).toBe(true);
  });

  it("leaves quietly when there is nothing to lose", () => {
    expect(confirmBeforeLeaving({ ...live, hasMessages: false })).toBe(false); // nothing sent yet
    expect(confirmBeforeLeaving({ ...live, ended: true })).toBe(false); // the persona already ended it
    expect(confirmBeforeLeaving({ ...live, readOnly: true })).toBe(false); // a record from History
    expect(confirmBeforeLeaving({ ...live, gone: true })).toBe(false); // deleted elsewhere
  });
});

describe("shouldAskForRating (spec §32.4)", () => {
  const live = { hasUserMessage: true, readOnly: false, gone: false };

  it("asks after leaving a live conversation the visitor spoke in", () => {
    expect(shouldAskForRating(live)).toBe(true);
  });

  it("doesn't ask when there's nothing to rate, or it's rated elsewhere", () => {
    expect(shouldAskForRating({ ...live, hasUserMessage: false })).toBe(false); // nothing sent, or it never reached the server
    expect(shouldAskForRating({ ...live, readOnly: true })).toBe(false); // a record: rated from History instead
    expect(shouldAskForRating({ ...live, gone: true })).toBe(false); // deleted elsewhere
  });
});
