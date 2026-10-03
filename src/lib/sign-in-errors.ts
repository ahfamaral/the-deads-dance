const TOO_MANY = "Too many attempts: try again in a few minutes.";
const CANT_VERIFY = "Can't verify you right now. Try again in a minute.";

/** Spec §24.6: Better Auth's error codes, in plain words. */
export function signInErrorMessage(e: { status?: number; code?: string } | null, triesLeft?: number): string {
  switch (e?.code) {
    case "INVALID_OTP":
      return triesLeft === undefined ? "That code isn't right." : `That code isn't right (${triesLeft} tries left).`;
    case "OTP_EXPIRED":
      return "That code expired: we can send a new one.";
    case "TOO_MANY_ATTEMPTS":
    case "EMAIL_RATE_LIMITED":
      return TOO_MANY;
    case "EMAIL_SEND_FAILED":
      return "Couldn't send the code. Try again in a minute.";
    case "VERIFICATION_FAILED":
    case "MISSING_RESPONSE":
    case "UNKNOWN_ERROR": // the captcha plugin's answer when Cloudflare is unreachable (fail closed)
      return CANT_VERIFY;
    case "BANNED_USER":
      return "Your account is blocked.";
  }
  if (e?.status === 429) return TOO_MANY;
  return "Something went wrong. Try again.";
}
