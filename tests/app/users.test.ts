import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import { closePool, getPool } from "@corpus/db";
import { approveUser, blockUser, listUsers, rejectUser } from "@/lib/server/users";
import { resetAuth } from "../helpers/db";

const approvals = vi.hoisted(() => ({ sent: [] as string[], fail: false }));
vi.mock("@/lib/server/email", () => ({
  sendCode: async () => {},
  sendApproval: async (email: string) => {
    if (approvals.fail) throw new Error("resend down");
    approvals.sent.push(email);
  },
}));

const pool = () => getPool();
async function user(email: string, status = "pending", role = "user"): Promise<string> {
  const id = crypto.randomUUID();
  await pool().query(`INSERT INTO "user" (id, name, email, "emailVerified", role, status) VALUES ($1, '', $2, true, $3, $4)`, [
    id, email, role, status,
  ]);
  return id;
}
const row = async (id: string) => (await pool().query(`SELECT * FROM "user" WHERE id = $1`, [id])).rows[0];

let admin: string;
beforeEach(async () => {
  approvals.sent.length = 0;
  approvals.fail = false;
  await resetAuth();
  admin = await user("boss@example.com", "approved", "admin");
});
afterAll(() => closePool());

describe("status changes", () => {
  it("approves a pending user, records who, and emails them once", async () => {
    const id = await user("ana@example.com");
    expect(await approveUser(pool(), id, admin)).toEqual({ ok: true, emailSent: true });
    expect(await row(id)).toMatchObject({ status: "approved", statusChangedBy: admin });
    expect((await row(id)).statusChangedAt).toBeInstanceOf(Date);
    expect(approvals.sent).toEqual(["ana@example.com"]);
  });

  it("keeps the approval when the email fails", async () => {
    approvals.fail = true;
    const id = await user("ana@example.com");
    expect(await approveUser(pool(), id, admin)).toEqual({ ok: true, emailSent: false });
    expect((await row(id)).status).toBe("approved");
  });

  it("applies a double approve once", async () => {
    const id = await user("ana@example.com");
    const [a, b] = await Promise.all([approveUser(pool(), id, admin), approveUser(pool(), id, admin)]);
    expect([a.ok, b.ok].sort()).toEqual([false, true]);
    expect(approvals.sent).toHaveLength(1);
    expect(await approveUser(pool(), id, admin)).toEqual({ ok: false, reason: "already_changed" });
  });

  it("rejects a pending user without email and keeps their sessions", async () => {
    const id = await user("ana@example.com");
    await pool().query(`INSERT INTO session (id, "expiresAt", token, "updatedAt", "userId") VALUES ('s1', now() + interval '1 day', 't1', now(), $1)`, [id]);
    expect(await rejectUser(pool(), id, admin)).toEqual({ ok: true });
    expect((await row(id)).status).toBe("rejected");
    expect(approvals.sent).toEqual([]);
    expect((await pool().query(`SELECT 1 FROM session WHERE "userId" = $1`, [id])).rowCount).toBe(1);
  });

  it("blocks an approved user: banned, and every session deleted", async () => {
    const id = await user("ana@example.com", "approved");
    await pool().query(`INSERT INTO session (id, "expiresAt", token, "updatedAt", "userId") VALUES ('s1', now() + interval '1 day', 't1', now(), $1)`, [id]);
    expect(await blockUser(pool(), id, admin)).toEqual({ ok: true });
    expect(await row(id)).toMatchObject({ status: "blocked", banned: true });
    expect((await pool().query(`SELECT 1 FROM session WHERE "userId" = $1`, [id])).rowCount).toBe(0);
  });

  it("refuses transitions the lifecycle doesn't have", async () => {
    const pending = await user("p@example.com");
    const approved = await user("a@example.com", "approved");
    expect(await blockUser(pool(), pending, admin)).toEqual({ ok: false, reason: "already_changed" });
    expect(await rejectUser(pool(), approved, admin)).toEqual({ ok: false, reason: "already_changed" });
    expect(await approveUser(pool(), "nope", admin)).toEqual({ ok: false, reason: "not_found" });
  });

  it("never changes an admin row, including the admin's own", async () => {
    const other = await user("other-admin@example.com", "pending", "admin");
    expect(await approveUser(pool(), other, admin)).toEqual({ ok: false, reason: "not_allowed" });
    expect(await blockUser(pool(), admin, admin)).toEqual({ ok: false, reason: "not_allowed" });
  });
});

describe("listUsers", () => {
  it("lists newest first, with who changed the status", async () => {
    const id = await user("ana@example.com");
    await approveUser(pool(), id, admin);
    const list = await listUsers(pool());
    expect(list[0]).toMatchObject({ email: "ana@example.com", status: "approved", statusChangedByEmail: "boss@example.com" });
    expect(list.map((u) => u.email)).toContain("boss@example.com");
  });
});
