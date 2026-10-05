import { betterAuth } from "better-auth";
import { APIError, createAuthMiddleware } from "better-auth/api";
import { nextCookies } from "better-auth/next-js";
import { admin, captcha, emailOTP } from "better-auth/plugins";
import { Pool, types } from "pg";
import { readAuthEnv, type AuthEnv } from "@/lib/server/auth-env";
import { sendCode } from "@/lib/server/email";
import { checkAndRecordSend } from "@/lib/server/email-rate-limit";

const DAY = 86_400;
export const USER_SESSION_SECONDS = 30 * DAY;
export const ADMIN_SESSION_SECONDS = 3 * DAY;
const SEND_PATH = "/email-otp/send-verification-otp";
// Per-request auth contexts whose code email failed. Weak, so nothing outlives its request.
const failedSends = new WeakSet<object>();

/**
 * Spec §24.4. Better Auth's options in one place. The pool is the auth pool (see getAuth), so its
 * int8 parser doesn't leak into the rest of the app.
 */
export function createAuth(opts: { pool: Pool; env: AuthEnv; siteVerifyURL?: string }) {
  const { pool, env } = opts;
  const adminUntil = () => new Date(Date.now() + ADMIN_SESSION_SECONDS * 1000);
  return betterAuth({
    database: pool,
    secret: env.secret,
    baseURL: env.baseURL,
    // Better Auth refreshes when expiresAt - expiresIn + updateAge has passed. expiresIn is the user
    // length (30 days), so the admin's 3-day session is due on every request: one UPDATE per request,
    // i.e. a sliding 3 days, "extended on each visit" as decided. Fine at tester scale.
    session: { expiresIn: USER_SESSION_SECONDS, updateAge: DAY, cookieCache: { enabled: false } },
    user: {
      additionalFields: {
        status: { type: "string", required: false, defaultValue: "pending", input: false },
        statusChangedAt: { type: "date", required: false, input: false },
        statusChangedBy: { type: "string", required: false, input: false },
      },
    },
    rateLimit: {
      enabled: true,
      storage: "database",
      customRules: {
        [SEND_PATH]: { window: 3600, max: 20 },
        "/sign-in/email-otp": { window: 60, max: 10 },
      },
    },
    advanced: { ipAddress: { ipAddressHeaders: [env.ipHeader] } },
    // Spec §24.4: the app signs in with codes only.
    disabledPaths: [
      "/sign-up/email",
      "/sign-in/email",
      "/sign-in/social",
      "/request-password-reset",
      "/reset-password",
      "/verify-password",
      "/change-password",
      "/change-email",
      "/update-user",
      "/link-social",
      "/email-otp/request-password-reset",
      "/forget-password/email-otp",
      "/email-otp/reset-password",
      "/email-otp/request-email-change",
      "/email-otp/change-email",
      "/email-otp/check-verification-otp",
      "/email-otp/verify-email",
      "/send-verification-email",
      "/verify-email",
      // The admin plugin is used only for its schema and the banned check. The app's own routes
      // change status with lifecycle rules and an audit trail; these would bypass both.
      "/admin/set-role",
      "/admin/get-user",
      "/admin/create-user",
      "/admin/update-user",
      "/admin/list-users",
      "/admin/list-user-sessions",
      "/admin/unban-user",
      "/admin/ban-user",
      "/admin/impersonate-user",
      "/admin/stop-impersonating",
      "/admin/revoke-user-session",
      "/admin/revoke-user-sessions",
      "/admin/remove-user",
      "/admin/set-user-password",
      "/admin/has-permission",
    ],
    hooks: {
      // Runs after the IP limit and Turnstile (spec §24.4), so only real attempts are counted.
      before: createAuthMiddleware(async (ctx) => {
        if (ctx.path !== SEND_PATH) return;
        const email = String((ctx.body as { email?: unknown } | undefined)?.email ?? "");
        if (!(await checkAndRecordSend(pool, email))) {
          throw new APIError("TOO_MANY_REQUESTS", { message: "Too many codes requested.", code: "EMAIL_RATE_LIMITED" });
        }
      }),
      // Spec §24.9: Better Auth awaits sendVerificationOTP but swallows its errors and answers
      // success, so a failed send is flagged on the request's context and turned into an error here.
      after: createAuthMiddleware(async (ctx) => {
        if (ctx.path !== SEND_PATH || !failedSends.has(ctx.context)) return;
        throw new APIError("BAD_GATEWAY", { message: "Couldn't send the code.", code: "EMAIL_SEND_FAILED" });
      }),
    },
    databaseHooks: {
      session: {
        create: {
          // ctx can be undefined here, so the role is read from the database.
          before: async (session) => {
            const { rows } = await pool.query(`SELECT role FROM "user" WHERE id = $1`, [session.userId]);
            if (rows[0]?.role === "admin") return { data: { ...session, expiresAt: adminUntil() } };
          },
        },
        update: {
          // A refresh resets expiresAt to 30 days; the admin goes back to 3. Never return false here.
          // The role comes from ctx.context.session, which every refresh path sets today (getSession
          // and the sign-in). An update without it would leave the admin at 30 days; the session-length
          // tests in auth-otp.test.ts pin the current behaviour.
          before: async (data, ctx) => {
            if (data.expiresAt && ctx?.context.session?.user?.role === "admin") {
              return { data: { ...data, expiresAt: adminUntil() } };
            }
          },
        },
      },
    },
    plugins: [
      emailOTP({
        otpLength: 6,
        expiresIn: 600,
        allowedAttempts: 5,
        async sendVerificationOTP({ email, otp }, ctx) {
          try {
            await sendCode(email, otp);
          } catch (err) {
            console.error(err);
            if (ctx) failedSends.add(ctx.context); // read by hooks.after
          }
        },
      }),
      captcha({
        provider: "cloudflare-turnstile",
        secretKey: env.turnstileSecret,
        endpoints: [SEND_PATH],
        ...(opts.siteVerifyURL ? { siteVerifyURLOverride: opts.siteVerifyURL } : {}),
      }),
      admin({ defaultRole: "user", adminRoles: ["admin"] }),
      nextCookies(), // must stay last
    ],
  });
}

export type Auth = ReturnType<typeof createAuth>;

// One auth instance and pool per process, like getPool (survives Next dev reloads).
const holder = globalThis as unknown as { personaAuth?: Auth };

/** The auth pool. rateLimit."lastRequest" is bigint; it's parsed as a number on this pool only (X-Retry-After). */
export function createAuthPool(connectionString = process.env.DATABASE_URL): Pool {
  return new Pool({
    connectionString,
    types: { getTypeParser: (oid, format) => (oid === 20 ? Number : types.getTypeParser(oid, format)) },
  });
}

export function getAuth(): Auth {
  if (!holder.personaAuth) holder.personaAuth = createAuth({ pool: createAuthPool(), env: readAuthEnv() });
  return holder.personaAuth;
}
