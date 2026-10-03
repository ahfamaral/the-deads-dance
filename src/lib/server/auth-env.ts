export type AuthEnv = {
  secret: string;
  baseURL: string;
  resendKey: string | null;
  emailFrom: string | null;
  turnstileSecret: string;
  ipHeader: string;
};

const ALWAYS = ["BETTER_AUTH_SECRET", "BETTER_AUTH_URL", "TURNSTILE_SECRET_KEY", "NEXT_PUBLIC_TURNSTILE_SITE_KEY"] as const;
// AUTH_IP_HEADER: without it, clients can spoof x-forwarded-for to get a fresh rate-limit bucket.
const IN_PRODUCTION = ["RESEND_API_KEY", "EMAIL_FROM", "AUTH_IP_HEADER"] as const;

/**
 * Spec §24.8. In production every key is required, so codes never fall back to the console there;
 * in dev, Resend is optional.
 */
export function readAuthEnv(env: NodeJS.ProcessEnv = process.env): AuthEnv {
  const required = env.NODE_ENV === "production" ? [...ALWAYS, ...IN_PRODUCTION] : ALWAYS;
  const missing = required.filter((k) => !env[k]?.trim());
  if (missing.length) throw new Error(`Missing auth env: ${missing.join(", ")}. See .env.example.`);
  return {
    secret: env.BETTER_AUTH_SECRET!,
    baseURL: env.BETTER_AUTH_URL!,
    resendKey: env.RESEND_API_KEY?.trim() || null,
    emailFrom: env.EMAIL_FROM?.trim() || null,
    turnstileSecret: env.TURNSTILE_SECRET_KEY!,
    ipHeader: env.AUTH_IP_HEADER?.trim() || "x-forwarded-for",
  };
}
