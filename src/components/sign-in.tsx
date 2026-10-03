"use client";

import { useCallback, useEffect, useState } from "react";
import CodeInput from "@/components/code-input";
import Turnstile from "@/components/turnstile";
import { authClient } from "@/lib/auth-client";
import { signInErrorMessage } from "@/lib/sign-in-errors";
import { SIGN_IN_STORAGE_KEY, cooldownLeft, parseSignInState, serializeSignInState } from "@/lib/sign-in-state";

const RESEND_SECONDS = 60;
const PRIMARY =
  "min-h-11 w-full rounded-full bg-neutral-100 px-4 text-sm font-semibold text-neutral-900 transition-colors hover:bg-white disabled:opacity-50";
// One row, one line, same height: the same approach as chat-session's END_BAR buttons.
const LINK =
  "inline-flex min-h-11 flex-1 items-center justify-center whitespace-nowrap px-1 text-[length:clamp(10px,2.9vw,12px)] text-neutral-300 underline underline-offset-2 disabled:no-underline disabled:opacity-50";

// sessionStorage can throw (private windows, blocked storage), so every access is guarded.
function readStored(): string | null {
  try {
    return sessionStorage.getItem(SIGN_IN_STORAGE_KEY);
  } catch {
    return null;
  }
}
function writeStored(value: string | null) {
  try {
    if (value === null) sessionStorage.removeItem(SIGN_IN_STORAGE_KEY);
    else sessionStorage.setItem(SIGN_IN_STORAGE_KEY, value);
  } catch {
    // Not persisted; the card still works.
  }
}

/** Spec §24.6: a two-step card. Step 1 email + Turnstile, step 2 the code. The code step survives a reload. */
export default function SignIn({ siteKey }: { siteKey: string }) {
  const [step, setStep] = useState<"email" | "code" | "blocked">("email");
  const [email, setEmail] = useState("");
  const [code, setCode] = useState("");
  const [token, setToken] = useState<string | null>(null);
  const [widgetKey, setWidgetKey] = useState(0);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [triesLeft, setTriesLeft] = useState(5);
  const [sentAt, setSentAt] = useState<number | null>(null);
  const [now, setNow] = useState(() => Date.now());
  const onToken = useCallback((t: string | null) => setToken(t), []);
  const cooldown = sentAt === null ? 0 : cooldownLeft(sentAt, now, RESEND_SECONDS);

  // Restore the code step after the page was reloaded or the app was switched away from.
  useEffect(() => {
    const saved = parseSignInState(readStored(), Date.now());
    if (!saved) return writeStored(null);
    // sessionStorage is only readable after hydration, so this has to be an effect.
    /* eslint-disable react-hooks/set-state-in-effect */
    setEmail(saved.email);
    setSentAt(saved.sentAt);
    setNow(Date.now());
    setStep("code");
    /* eslint-enable react-hooks/set-state-in-effect */
  }, []);

  useEffect(() => {
    if (cooldown <= 0) return;
    const t = setTimeout(() => setNow(Date.now()), 1000);
    return () => clearTimeout(t);
  }, [cooldown, now]);

  async function sendCode() {
    if (!token) return setError("Can't verify you right now. Try again in a minute.");
    setBusy(true);
    setError(null);
    const { error: e } = await authClient.emailOtp.sendVerificationOtp({
      email: email.trim(),
      type: "sign-in",
      fetchOptions: { headers: { "x-captcha-response": token } },
    });
    setBusy(false);
    setToken(null);
    setWidgetKey((k) => k + 1); // a token is single-use
    if (e) return setError(signInErrorMessage(e));
    const at = Date.now();
    writeStored(serializeSignInState(email.trim(), at));
    setSentAt(at);
    setNow(at);
    setStep("code");
    setCode("");
    setTriesLeft(5);
  }

  async function verify(otp: string) {
    setBusy(true);
    setError(null);
    const { error: e } = await authClient.signIn.emailOtp({ email: email.trim(), otp });
    setBusy(false);
    if (!e) {
      writeStored(null);
      // eslint-disable-next-line @next/next/no-location-assign-relative-destination -- full reload so page.tsx re-picks the screen
      return window.location.assign("/");
    }
    if (e.code === "BANNED_USER") {
      writeStored(null);
      return setStep("blocked");
    }
    const left = e.code === "INVALID_OTP" ? triesLeft - 1 : triesLeft;
    setTriesLeft(left);
    setCode("");
    setError(signInErrorMessage(e, left));
  }

  return (
    <div className="flex flex-1 items-center justify-center">
      <section className="flex w-full max-w-[280px] flex-col items-center gap-4 text-center">
        {step === "email" && (
          <form
            className="flex w-full flex-col items-center gap-4"
            onSubmit={(e) => {
              e.preventDefault();
              void sendCode();
            }}
          >
            <h1 className="text-xl font-semibold">Do the deads dance</h1>
            <p className="text-sm leading-relaxed text-neutral-400">
              Ask a science or engineering pioneer, in their own voice. Staging: access is by approval.
            </p>
            <input
              type="email"
              required
              autoFocus
              autoComplete="email"
              placeholder="you@example.com"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className="min-h-11 w-full rounded-full border border-white/15 bg-neutral-900/60 px-4 text-sm text-foreground placeholder:text-neutral-500 focus:border-white/50 focus:outline-none"
            />
            <Turnstile siteKey={siteKey} onToken={onToken} resetKey={widgetKey} />
            <button type="submit" disabled={busy || !email.trim()} className={PRIMARY}>
              Send code
            </button>
            <p className="text-xs text-neutral-500">New here? The same form signs you up.</p>
          </form>
        )}

        {step === "code" && (
          <div className="flex w-full flex-col items-center gap-4">
            <h1 className="text-xl font-semibold">Check your email</h1>
            <p className="text-sm leading-relaxed text-neutral-400">
              We sent a 6-digit code to <span className="text-foreground">{email.trim().toLowerCase()}</span>. It expires in
              10 minutes.
            </p>
            <CodeInput value={code} onChange={setCode} onComplete={(v) => void verify(v)} disabled={busy} />
            <button type="button" disabled={busy || code.length !== 6} onClick={() => void verify(code)} className={PRIMARY}>
              Sign in
            </button>
            <div className="flex w-full">
              <button
                type="button"
                className={LINK}
                disabled={cooldown > 0 || busy}
                onClick={() => {
                  setStep("email");
                  setError(null);
                }}
              >
                {cooldown > 0 ? `Resend code (0:${String(cooldown).padStart(2, "0")})` : "Resend code"}
              </button>
              <button
                type="button"
                className={LINK}
                onClick={() => {
                  writeStored(null);
                  setSentAt(null);
                  setStep("email");
                  setEmail("");
                  setError(null);
                }}
              >
                Use a different email
              </button>
            </div>
          </div>
        )}

        {step === "blocked" && (
          <div className="flex w-full flex-col items-center gap-4">
            <h1 className="text-xl font-semibold">Your account is blocked</h1>
            <p className="text-sm text-neutral-400">
              Access for <span className="text-foreground">{email.trim().toLowerCase()}</span> has been turned off.
            </p>
          </div>
        )}

        {error && (
          <p role="alert" className="text-sm text-red-300">
            {error}
          </p>
        )}
      </section>
    </div>
  );
}
