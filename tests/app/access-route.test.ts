import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { closePool, getPool } from "@corpus/db";
import { GET } from "@/app/api/access/route";
import { blockUser } from "@/lib/server/users";
import { resetAuth } from "../helpers/db";
import { signInAs, withCookie } from "../helpers/auth";
import { giveEnergy } from "../helpers/energy";

const check = (cookie?: string) =>
  GET(new Request("http://localhost/api/access", { headers: cookie ? { cookie } : {} }));

beforeEach(() => resetAuth());
afterAll(() => closePool());

describe("GET /api/access", () => {
  it("tells a tester how much energy is left, never money", async () => {
    const { cookie, userId } = await signInAs("ana@example.com", { status: "approved" });
    await giveEnergy(userId, 180_000, 1_000_000);
    const res = await GET(new Request("http://localhost/api/access", withCookie(cookie)));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toEqual({ energy: { left: 0.18, warningRead: 100 } });
    expect(JSON.stringify(body)).not.toMatch(/cost|tokens|\$/);
  });

  it("tells the admin their spend today", async () => {
    const { cookie } = await signInAs("boss@example.com", { role: "admin" });
    const res = await GET(new Request("http://localhost/api/access", withCookie(cookie)));
    expect(await res.json()).toEqual({ spend: { today: { tokens: 0, cost: 0 } } });
  });

  it("answers 401 when signed out, including a blocked user's old cookie", async () => {
    expect((await check()).status).toBe(401);
    const boss = await signInAs("boss@example.com", { role: "admin" });
    const ana = await signInAs("ana@example.com", { status: "approved" });
    await blockUser(getPool(), ana.userId, boss.userId);
    expect((await check(ana.cookie)).status).toBe(401);
  });

  it("answers 403 to pending and rejected users", async () => {
    for (const s of ["pending", "rejected"] as const) {
      const { cookie } = await signInAs(`${s}@example.com`, { status: s });
      expect((await check(cookie)).status).toBe(403);
    }
  });
});
