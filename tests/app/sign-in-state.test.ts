import { describe, expect, it } from "vitest";
import { CODE_LIFE_MS, cooldownLeft, parseSignInState, serializeSignInState } from "@/lib/sign-in-state";

const NOW = 1_700_000_000_000;

describe("sign-in state", () => {
  it("round-trips a fresh code step", () => {
    const raw = serializeSignInState("a@b.c", NOW - 5_000);
    expect(parseSignInState(raw, NOW)).toEqual({ step: "code", email: "a@b.c", sentAt: NOW - 5_000 });
  });

  it("drops a state older than the code's life", () => {
    const raw = serializeSignInState("a@b.c", NOW - CODE_LIFE_MS - 1);
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
