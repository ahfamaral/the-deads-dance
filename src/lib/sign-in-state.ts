/**
 * Spec §24.6: the code step survives switching apps on a phone (the page can be reloaded while the
 * visitor reads their email). Only the pure read/validate part lives here; sessionStorage access is
 * in the component, always inside try/catch.
 */
export const SIGN_IN_STORAGE_KEY = "deads-dance:sign-in";
/** A code lives 10 minutes (spec §24.4). */
export const CODE_LIFE_MS = 600_000;

export type SignInState = { step: "code"; email: string; sentAt: number };

export function serializeSignInState(email: string, sentAt: number): string {
  return JSON.stringify({ step: "code", email, sentAt } satisfies SignInState);
}

/** The stored state, or null when missing, malformed, from the future, or past the code's life. */
export function parseSignInState(raw: string | null, now: number): SignInState | null {
  if (!raw) return null;
  let v: unknown;
  try {
    v = JSON.parse(raw);
  } catch {
    return null;
  }
  if (typeof v !== "object" || v === null) return null;
  const { step, email, sentAt } = v as Record<string, unknown>;
  if (step !== "code" || typeof email !== "string" || !email || typeof sentAt !== "number" || !Number.isFinite(sentAt)) return null;
  if (sentAt > now || now - sentAt > CODE_LIFE_MS) return null;
  return { step: "code", email, sentAt };
}

/** Whole seconds of the resend cooldown left. */
export function cooldownLeft(sentAt: number, now: number, seconds: number): number {
  return Math.max(0, Math.ceil(seconds - (now - sentAt) / 1000));
}
