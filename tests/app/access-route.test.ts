import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { closePool, getPool } from "@corpus/db";
import { GET } from "@/app/api/access/route";
import { blockUser } from "@/lib/server/users";
import { resetAuth } from "../helpers/db";
import { signInAs } from "../helpers/auth";

const check = (cookie?: string) =>
  GET(new Request("http://localhost/api/access", { headers: cookie ? { cookie } : {} }));

beforeEach(() => resetAuth());
afterAll(() => closePool());

describe("GET /api/access", () => {
  it("answers 204 to approved users and the admin", async () => {
    const ok = await signInAs("ok@example.com", { status: "approved" });
    expect((await check(ok.cookie)).status).toBe(204);
    const boss = await signInAs("boss@example.com", { role: "admin" });
    expect((await check(boss.cookie)).status).toBe(204);
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
