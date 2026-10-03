import { getPool } from "@corpus/db";
import { getAuth } from "@/lib/server/auth";

type Status = "pending" | "approved" | "rejected" | "blocked";

/**
 * Signs in through the real OTP endpoint (server API, so no captcha or IP limit) and returns the
 * session cookie. The role is set before sign-in so the session gets its role's length; the status
 * is set after, as an admin would.
 */
export async function signInAs(
  email: string,
  opts: { role?: "user" | "admin"; status?: Status } = {},
): Promise<{ userId: string; cookie: string }> {
  const auth = getAuth();
  const lower = email.toLowerCase();
  if (opts.role === "admin") {
    await getPool().query(
      `INSERT INTO "user" (id, name, email, "emailVerified", role, status) VALUES ($1, '', $2, true, 'admin', 'approved')
       ON CONFLICT (email) DO UPDATE SET role = 'admin'`,
      [crypto.randomUUID(), lower],
    );
  }
  const otp = await auth.api.createVerificationOTP({ body: { email: lower, type: "sign-in" } });
  const { headers, response } = await auth.api.signInEmailOTP({ body: { email: lower, otp }, returnHeaders: true });
  const cookie = (headers.get("set-cookie") ?? "").split(";")[0];
  if (opts.status) await getPool().query(`UPDATE "user" SET status = $2 WHERE id = $1`, [response.user.id, opts.status]);
  return { userId: response.user.id, cookie };
}

export function withCookie(cookie: string, init: RequestInit = {}): RequestInit {
  return { ...init, headers: { ...(init.headers as Record<string, string> | undefined), cookie } };
}
