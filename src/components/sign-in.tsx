"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import CodeInput from "@/components/code-input";
import Turnstile from "@/components/turnstile";
import { AUTH_CARD } from "@/lib/auth-card";
import { authClient } from "@/lib/auth-client";
import { signInErrorMessage } from "@/lib/sign-in-errors";
import { MAX_TRIES, SIGN_IN_STORAGE_KEY, cooldownLeft, parseSignInState, serializeSignInState } from "@/lib/sign-in-state";

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
  const [triesLeft, setTriesLeft] = useState(MAX_TRIES);
  const [sentAt, setSentAt] = useState<number | null>(null);
  const [now, setNow] = useState(() => Date.now());
  // Set synchronously, unlike `busy`: a 7th keystroke before the re-render can't start a second check.
  const verifying = useRef(false);
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
    setTriesLeft(saved.triesLeft);
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
    writeStored(serializeSignInState(email.trim(), at, MAX_TRIES));
    setSentAt(at);
    setNow(at);
    setStep("code");
    setCode("");
    setTriesLeft(MAX_TRIES);
  }

  async function verify(otp: string) {
    if (verifying.current) return;
    verifying.current = true;
    setBusy(true);
    setError(null);
    const { error: e } = await authClient.signIn.emailOtp({ email: email.trim(), otp });
    verifying.current = false;
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
    const left = e.code === "INVALID_OTP" ? Math.max(0, triesLeft - 1) : triesLeft;
    setTriesLeft(left);
    if (sentAt !== null) writeStored(serializeSignInState(email.trim(), sentAt, left));
    setCode("");
    setError(signInErrorMessage(e, left));
  }

  return (
    // On phones the card sits at the top, so the keyboard never covers its button; centred from sm up.
    <div className="flex flex-1 items-start justify-center sm:items-center">
      <section className={AUTH_CARD}>
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
              Staging: access is by approval.
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
            <p className="text-xs text-neutral-500">
              Your conversations are stored on our server, so you can see them on any device. Delete one from History at any time.
            </p>
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
            {/* No button: the 6th digit, typed or pasted, submits. A fixed-height line says when it's checking. */}
            <p aria-live="polite" className="min-h-5 text-sm text-neutral-400">
              {busy ? "Checking your code…" : ""}
            </p>
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
