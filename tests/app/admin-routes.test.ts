import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import { closePool } from "@corpus/db";
import { GET } from "@/app/api/admin/users/route";
import { POST } from "@/app/api/admin/users/[id]/[action]/route";
import { requireApproved } from "@/lib/server/access";
import { resetAuth } from "../helpers/db";
import { signInAs, withCookie } from "../helpers/auth";
import { GET as SPEND } from "@/app/api/admin/spend/route";

vi.mock("@/lib/server/email", () => ({ sendCode: async () => {}, sendApproval: async () => {} }));
vi.mock("@/lib/server/openrouter-credit", () => ({ keyCredit: async () => null }));

let boss: { userId: string; cookie: string };
beforeEach(async () => {
  await resetAuth();
  boss = await signInAs("boss@example.com", { role: "admin" });
});
afterAll(() => closePool());

const list = (cookie: string) => GET(new Request("http://localhost/api/admin/users", { headers: { cookie } }));
const act = (cookie: string, id: string, action: string) =>
  POST(new Request(`http://localhost/api/admin/users/${id}/${action}`, { method: "POST", headers: { cookie } }), {
    params: Promise.resolve({ id, action }),
  });

describe("admin API", () => {
  it("is hidden (404) from everyone but the admin", async () => {
    const t = await signInAs("t@example.com", { status: "approved" });
    expect((await list(t.cookie)).status).toBe(404);
    expect((await act(t.cookie, t.userId, "approve")).status).toBe(404);
    expect((await list("")).status).toBe(404);
  });

  it("lists users and approves one", async () => {
    const ana = await signInAs("ana@example.com");
    const users = (await (await list(boss.cookie)).json()).users;
    expect(users.find((u: { email: string }) => u.email === "ana@example.com")).toMatchObject({ status: "pending" });
    const res = await act(boss.cookie, ana.userId, "approve");
    expect(await res.json()).toEqual({ ok: true, emailSent: true });
  });

  it("reports a change that no longer applies with 409, and an unknown action with 404", async () => {
    const ana = await signInAs("ana@example.com");
    await act(boss.cookie, ana.userId, "approve");
    const again = await act(boss.cookie, ana.userId, "approve");
    expect(again.status).toBe(409);
    expect(await again.json()).toMatchObject({ ok: false, reason: "already_changed", error: "Already changed." });
    expect((await act(boss.cookie, ana.userId, "promote")).status).toBe(404);
  });

  it("unblocks a blocked user, who can then sign in again", async () => {
    const ana = await signInAs("ana@example.com", { status: "approved" });
    expect(await (await act(boss.cookie, ana.userId, "block")).json()).toEqual({ ok: true });
    expect(await (await act(boss.cookie, ana.userId, "unblock")).json()).toEqual({ ok: true });
    expect((await act(boss.cookie, ana.userId, "unblock")).status).toBe(409);
    const again = await signInAs("ana@example.com");
    expect(await requireApproved(new Request("http://localhost/x", { headers: { cookie: again.cookie } }))).toMatchObject({
      email: "ana@example.com",
      status: "approved",
    });
  });

  it("rejects prototype pollution attacks with 404", async () => {
    const ana = await signInAs("ana@example.com");
    expect((await act(boss.cookie, ana.userId, "constructor")).status).toBe(404);
    expect((await act(boss.cookie, ana.userId, "__proto__")).status).toBe(404);
    expect((await act(boss.cookie, ana.userId, "toString")).status).toBe(404);
  });
});

describe("GET /api/admin/spend (spec §26.6)", () => {
  it("answers the credit, the logged spend and the energy testers hold", async () => {
    const { cookie } = await signInAs("boss@example.com", { role: "admin" });
    const res = await SPEND(new Request("http://localhost/api/admin/spend", withCookie(cookie)));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      credit: null,
      logged: { today: { tokens: 0, cost: 0 }, week: { tokens: 0, cost: 0 }, month: { tokens: 0, cost: 0 } },
      held: 0,
    });
  });

  it("is a 404 for a tester", async () => {
    const { cookie } = await signInAs("ana@example.com", { status: "approved" });
    expect((await SPEND(new Request("http://localhost/api/admin/spend", withCookie(cookie)))).status).toBe(404);
  });
});
