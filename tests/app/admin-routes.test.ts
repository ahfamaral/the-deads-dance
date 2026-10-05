import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import { closePool } from "@corpus/db";
import { GET } from "@/app/api/admin/users/route";
import { POST } from "@/app/api/admin/users/[id]/[action]/route";
import { requireApproved } from "@/lib/server/access";
import { resetAuth } from "../helpers/db";
import { signInAs } from "../helpers/auth";

vi.mock("@/lib/server/email", () => ({ sendCode: async () => {}, sendApproval: async () => {} }));

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
