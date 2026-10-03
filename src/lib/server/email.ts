import { readAuthEnv } from "@/lib/server/auth-env";

async function send(to: string, subject: string, text: string, html: string): Promise<void> {
  const env = readAuthEnv();
  if (!env.resendKey || !env.emailFrom) {
    // Dev only: readAuthEnv requires both keys in production.
    console.info(`[email] to ${to}: ${subject}\n${text}`);
    return;
  }
  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: { Authorization: `Bearer ${env.resendKey}`, "Content-Type": "application/json" },
    body: JSON.stringify({ from: env.emailFrom, to, subject, text, html }),
    signal: AbortSignal.timeout(10_000),
  });
  if (!res.ok) throw new Error(`Resend refused the email (${res.status}).`);
}

/** Spec §24.7: the sign-in code. Throws when the email can't be sent. */
export function sendCode(email: string, code: string): Promise<void> {
  const text = `Your code is ${code}. It expires in 10 minutes.`;
  return send(email, "Your sign-in code", text, `<p>Your code is <strong>${code}</strong>.</p><p>It expires in 10 minutes.</p>`);
}

/** Spec §24.7: the approval notice. A plain link to the site, not a sign-in link. */
export function sendApproval(email: string): Promise<void> {
  const url = readAuthEnv().baseURL;
  const text = `Your request was approved. Sign in at ${url} with this email.`;
  return send(
    email,
    "You're in: Do the deads dance",
    text,
    `<p>Your request was approved.</p><p>Sign in at <a href="${url}">${url}</a> with this email.</p>`,
  );
}
