import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import type { Pool } from "pg";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { closePool, getPool } from "@corpus/db";
import { createAuth, createAuthPool, type Auth } from "@/lib/server/auth";
import { readAuthEnv } from "@/lib/server/auth-env";
import { resetAuth } from "../helpers/db";

const sent = vi.hoisted(() => [] as string[]);
const mail = vi.hoisted(() => ({ down: false }));
vi.mock("@/lib/server/email", () => ({
  sendCode: async (email: string) => {
    if (mail.down) throw new Error("resend down");
    sent.push(email);
  },
  sendApproval: async () => {},
}));

let siteverify: { success: boolean; down: boolean } = { success: true, down: false };
let server: Server;
let auth: Auth;
let authPool: Pool;

beforeAll(async () => {
  server = createServer((req, res) => {
    if (siteverify.down) return req.socket.destroy();
    res.setHeader("content-type", "application/json");
    res.end(JSON.stringify({ success: siteverify.success }));
  });
  await new Promise<void>((r) => server.listen(0, r));
  const url = `http://127.0.0.1:${(server.address() as AddressInfo).port}/siteverify`;
  authPool = createAuthPool(); // the same int8 parser as getAuth's pool
  auth = createAuth({ pool: authPool, env: readAuthEnv(), siteVerifyURL: url });
});
afterAll(async () => {
  server.close();
  await authPool.end();
  await closePool();
});
beforeEach(async () => {
  sent.length = 0;
  mail.down = false;
  siteverify = { success: true, down: false };
  await resetAuth();
});

const sendCode = (email: string, ip = "198.51.100.1", token: string | null = "tok") =>
  auth.handler(
    new Request("http://localhost:3000/api/auth/email-otp/send-verification-otp", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        origin: "http://localhost:3000",
        "x-forwarded-for": ip,
        ...(token ? { "x-captcha-response": token } : {}),
      },
      body: JSON.stringify({ email, type: "sign-in" }),
    }),
  );

describe("send code over HTTP", () => {
  it("sends with a valid Turnstile token", async () => {
    expect((await sendCode("ana@example.com")).status).toBe(200);
    expect(sent).toEqual(["ana@example.com"]);
  });

  it("fails closed: no token, a refused token, or Cloudflare down all send nothing", async () => {
    expect((await sendCode("ana@example.com", "198.51.100.2", null)).status).toBe(400);
    siteverify.success = false;
    expect((await sendCode("ana@example.com", "198.51.100.3")).status).toBe(403);
    siteverify = { success: true, down: true };
    expect((await sendCode("ana@example.com", "198.51.100.4")).status).toBe(500);
    expect(sent).toEqual([]);
  });

  it("answers 502 EMAIL_SEND_FAILED when the email fails, and the next request is unaffected", async () => {
    mail.down = true;
    const quiet = vi.spyOn(console, "error").mockImplementation(() => {});
    const res = await sendCode("ana@example.com", "198.51.100.7");
    quiet.mockRestore();
    expect(res.status).toBe(502);
    expect((await res.json()).code).toBe("EMAIL_SEND_FAILED");
    mail.down = false;
    expect((await sendCode("bo@example.com", "198.51.100.8")).status).toBe(200);
  });

  it("allows one code a minute per email, whatever the casing", async () => {
    expect((await sendCode("ana@example.com", "198.51.100.5")).status).toBe(200);
    const res = await sendCode("ANA@example.com", "198.51.100.6");
    expect(res.status).toBe(429);
    expect((await res.json()).code).toBe("EMAIL_RATE_LIMITED");
  });

  it("allows five codes an hour per email", async () => {
    for (let i = 0; i < 5; i++) {
      await getPool().query(`INSERT INTO otp_send_log (email, sent_at) VALUES ('ana@example.com', now() - interval '10 minutes')`);
    }
    expect((await sendCode("ana@example.com", "198.51.100.7")).status).toBe(429);
  });

  it("allows 20 codes an hour per IP, with a sane Retry-After", async () => {
    for (let i = 0; i < 20; i++) expect((await sendCode(`u${i}@example.com`, "203.0.113.9")).status).toBe(200);
    const res = await sendCode("u20@example.com", "203.0.113.9");
    expect(res.status).toBe(429);
    const retry = Number(res.headers.get("X-Retry-After"));
    expect(retry).toBeGreaterThan(0);
    expect(retry).toBeLessThanOrEqual(3600);
  });

  it("returns 404 for disabled paths", async () => {
    const res = await auth.handler(
      new Request("http://localhost:3000/api/auth/sign-in/email", {
        method: "POST",
        headers: { "content-type": "application/json", origin: "http://localhost:3000" },
        body: JSON.stringify({ email: "a@b.c", password: "x" }),
      }),
    );
    expect(res.status).toBe(404);
  });

  it.each([
    "/admin/set-role",
    "/admin/update-user",
    "/admin/unban-user",
    "/admin/ban-user",
    "/admin/create-user",
    "/admin/remove-user",
    "/admin/impersonate-user",
    "/admin/stop-impersonating",
    "/admin/set-user-password",
    "/admin/revoke-user-session",
    "/admin/revoke-user-sessions",
    "/admin/has-permission",
    "/email-otp/check-verification-otp",
    "/email-otp/verify-email",
    "/send-verification-email",
    "/verify-email",
  ])("returns 404 for the unused POST %s", async (path) => {
    const res = await auth.handler(
      new Request(`http://localhost:3000/api/auth${path}`, {
        method: "POST",
        headers: { "content-type": "application/json", origin: "http://localhost:3000" },
        body: JSON.stringify({}),
      }),
    );
    expect(res.status).toBe(404);
  });

  it.each(["/admin/list-users", "/admin/get-user", "/admin/list-user-sessions", "/verify-email"])("returns 404 for the unused GET %s", async (path) => {
    const res = await auth.handler(new Request(`http://localhost:3000/api/auth${path}`, { headers: { origin: "http://localhost:3000" } }));
    expect(res.status).toBe(404);
  });
});
