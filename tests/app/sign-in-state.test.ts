import { describe, expect, it } from "vitest";
import { CODE_LIFE_MS, MAX_TRIES, cooldownLeft, parseSignInState, serializeSignInState } from "@/lib/sign-in-state";

const NOW = 1_700_000_000_000;

describe("sign-in state", () => {
  it("round-trips a fresh code step, with the tries left", () => {
    const raw = serializeSignInState("a@b.c", NOW - 5_000, 3);
    expect(parseSignInState(raw, NOW)).toEqual({ step: "code", email: "a@b.c", sentAt: NOW - 5_000, triesLeft: 3 });
  });

  it("reads a missing or invalid tries count as the full five", () => {
    const old = JSON.stringify({ step: "code", email: "a@b.c", sentAt: NOW });
    expect(parseSignInState(old, NOW)?.triesLeft).toBe(MAX_TRIES);
    for (const t of [-1, 6, 2.5, "3"]) {
      const raw = JSON.stringify({ step: "code", email: "a@b.c", sentAt: NOW, triesLeft: t });
      expect(parseSignInState(raw, NOW)?.triesLeft).toBe(MAX_TRIES);
    }
    expect(parseSignInState(serializeSignInState("a@b.c", NOW, 0), NOW)?.triesLeft).toBe(0);
  });

  it("drops a state older than the code's life", () => {
    const raw = serializeSignInState("a@b.c", NOW - CODE_LIFE_MS - 1, MAX_TRIES);
    expect(parseSignInState(raw, NOW)).toBeNull();
  });

  it.each([null, "", "not json", "{}", '{"step":"email","email":"a@b.c","sentAt":1}', '{"step":"code","email":"","sentAt":1}',
    '{"step":"code","email":"a@b.c","sentAt":"x"}', `{"step":"code","email":"a@b.c","sentAt":${NOW + 60_000}}`])(
    "rejects malformed or future state %j",
    (raw) => {
      expect(parseSignInState(raw, NOW)).toBeNull();
    },
  );

  it("derives the resend cooldown from sentAt", () => {
    expect(cooldownLeft(NOW - 1_000, NOW, 60)).toBe(59);
    expect(cooldownLeft(NOW - 59_500, NOW, 60)).toBe(1);
    expect(cooldownLeft(NOW - 61_000, NOW, 60)).toBe(0);
  });
});
