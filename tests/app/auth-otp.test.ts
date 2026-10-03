import { APIError } from "better-auth/api";
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import { closePool, getPool } from "@corpus/db";
import { readAuthEnv } from "@/lib/server/auth-env";
import { ADMIN_SESSION_SECONDS, USER_SESSION_SECONDS, getAuth } from "@/lib/server/auth";
import { resetAuth } from "../helpers/db";
import { signInAs } from "../helpers/auth";

const sent = vi.hoisted(() => [] as { email: string; code: string }[]);
vi.mock("@/lib/server/email", () => ({
  sendCode: async (email: string, code: string) => void sent.push({ email, code }),
  sendApproval: async () => {},
}));

const auth = () => getAuth();
const send = (email: string) => auth().api.sendVerificationOTP({ body: { email, type: "sign-in" } });
const signIn = (email: string, otp: string) => auth().api.signInEmailOTP({ body: { email, otp } });
const codeOf = (e: unknown) => (e instanceof APIError ? (e.body as { code?: string }).code : String(e));
const days = (d: Date) => (d.getTime() - Date.now()) / 86_400_000;

beforeEach(async () => {
  sent.length = 0;
  await resetAuth();
});
afterAll(() => closePool());

describe("sign-in with an emailed code", () => {
  it("creates the user only when the code is verified, as pending", async () => {
    await send("Ana@Example.com");
    expect(sent).toHaveLength(1);
    expect(sent[0].email).toBe("ana@example.com");
    expect(sent[0].code).toMatch(/^\d{6}$/);
    expect((await getPool().query(`SELECT 1 FROM "user"`)).rowCount).toBe(0);

    const res = await signIn("ana@example.com", sent[0].code);
    expect(res.user).toMatchObject({ email: "ana@example.com", status: "pending", role: "user" });
  });

  it("refuses a wrong code, then voids the code after five wrong tries", async () => {
    await send("ana@example.com");
    const errors: (string | undefined)[] = [];
    for (let i = 0; i < 6; i++) errors.push(await signIn("ana@example.com", "000000").then(() => "ok", codeOf));
    expect(errors.slice(0, 5)).toEqual(Array(5).fill("INVALID_OTP"));
    expect(errors[5]).toBe("TOO_MANY_ATTEMPTS");
    expect(await signIn("ana@example.com", sent[0].code).then(() => "ok", codeOf)).not.toBe("ok");
  });

  it("refuses an expired code", async () => {
    await send("ana@example.com");
    await getPool().query(`UPDATE verification SET "expiresAt" = now() - interval '1 second'`);
    expect(await signIn("ana@example.com", sent[0].code).then(() => "ok", codeOf)).toBe("OTP_EXPIRED");
  });

  it("ignores a status sent by the client", async () => {
    await send("ana@example.com");
    const res = await auth().api.signInEmailOTP({
      body: { email: "ana@example.com", otp: sent[0].code, status: "approved" } as never,
    });
    expect((res.user as { status?: string }).status).toBe("pending");
  });

  it("gives a banned user no session", async () => {
    const { userId } = await signInAs("ana@example.com");
    await getPool().query(`UPDATE "user" SET banned = true WHERE id = $1`, [userId]);
    await send("ana@example.com");
    expect(await signIn("ana@example.com", sent[0].code).then(() => "ok", codeOf)).toBe("BANNED_USER");
  });
});

describe("session length", () => {
  const expiry = async (userId: string) =>
    (await getPool().query(`SELECT "expiresAt" FROM session WHERE "userId" = $1`, [userId])).rows[0].expiresAt as Date;

  it("is 30 days for a user and 3 days for the admin", async () => {
    const user = await signInAs("ana@example.com");
    const admin = await signInAs("boss@example.com", { role: "admin" });
    expect(days(await expiry(user.userId))).toBeCloseTo(USER_SESSION_SECONDS / 86400, 1);
    expect(days(await expiry(admin.userId))).toBeCloseTo(ADMIN_SESSION_SECONDS / 86400, 1);
  });

  it("keeps the admin at 3 days when the session is refreshed", async () => {
    const admin = await signInAs("boss@example.com", { role: "admin" });
    await getPool().query(`UPDATE session SET "expiresAt" = now() + interval '1 day' WHERE "userId" = $1`, [admin.userId]);
    await auth().api.getSession({ headers: new Headers({ cookie: admin.cookie }) });
    expect(days(await expiry(admin.userId))).toBeCloseTo(3, 1);
  });

  it("reads approval changes at once (no cookie cache)", async () => {
    const user = await signInAs("ana@example.com");
    await getPool().query(`UPDATE "user" SET status = 'approved' WHERE id = $1`, [user.userId]);
    const s = await auth().api.getSession({ headers: new Headers({ cookie: user.cookie }) });
    expect(s?.user.status).toBe("approved");
  });
});

describe("readAuthEnv", () => {
  it("stops production when a required var is missing", () => {
    expect(() => readAuthEnv({ NODE_ENV: "production" } as NodeJS.ProcessEnv)).toThrow(/BETTER_AUTH_SECRET/);
    expect(() =>
      readAuthEnv({
        NODE_ENV: "production",
        BETTER_AUTH_SECRET: "s".repeat(32),
        BETTER_AUTH_URL: "https://x",
        TURNSTILE_SECRET_KEY: "t",
        NEXT_PUBLIC_TURNSTILE_SITE_KEY: "t",
        AUTH_IP_HEADER: "x-real-ip",
      } as NodeJS.ProcessEnv),
    ).toThrow(/RESEND_API_KEY/);
  });

  it("requires AUTH_IP_HEADER in production", () => {
    const base = {
      NODE_ENV: "production",
      BETTER_AUTH_SECRET: "s".repeat(32),
      BETTER_AUTH_URL: "https://x",
      TURNSTILE_SECRET_KEY: "t",
      NEXT_PUBLIC_TURNSTILE_SITE_KEY: "t",
      RESEND_API_KEY: "r",
      EMAIL_FROM: "a@b.c",
    };
    expect(() => readAuthEnv(base as NodeJS.ProcessEnv)).toThrow(/AUTH_IP_HEADER/);
    expect(readAuthEnv({ ...base, AUTH_IP_HEADER: "x-real-ip" } as NodeJS.ProcessEnv).ipHeader).toBe("x-real-ip");
  });

  it("lets dev run without Resend", () => {
    const env = readAuthEnv({
      NODE_ENV: "development",
      BETTER_AUTH_SECRET: "s".repeat(32),
      BETTER_AUTH_URL: "http://localhost:3000",
      TURNSTILE_SECRET_KEY: "t",
      NEXT_PUBLIC_TURNSTILE_SITE_KEY: "t",
    } as NodeJS.ProcessEnv);
    expect(env.resendKey).toBeNull();
    expect(env.ipHeader).toBe("x-forwarded-for");
  });
});
