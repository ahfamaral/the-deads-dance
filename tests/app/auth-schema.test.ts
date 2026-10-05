import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { closePool, getPool } from "@corpus/db";
import { resetAuth } from "../helpers/db";

beforeEach(() => resetAuth());
afterAll(() => closePool());

// A fresh id each time, so a row that slips in (if a constraint went missing) can't collide later.
const insertUser = (fields: { status?: string; role?: string; statusChangedBy?: string } = {}) => {
  const id = crypto.randomUUID();
  return getPool()
    .query(
      `INSERT INTO "user" (id, name, email, "emailVerified", status, role, "statusChangedBy")
       VALUES ($1, '', $2, true, coalesce($3, 'pending'), $4, $5)`,
      [id, `${id}@example.com`, fields.status ?? null, fields.role ?? null, fields.statusChangedBy ?? null],
    )
    .then(() => id);
};

describe("auth schema", () => {
  it("has Better Auth's tables and our status column", async () => {
    const { rows } = await getPool().query(
      `SELECT table_name FROM information_schema.tables
       WHERE table_schema = 'public' AND table_name IN ('user','session','account','verification','rateLimit','otp_send_log')
       ORDER BY table_name`,
    );
    expect(rows.map((r) => r.table_name)).toEqual(["account", "otp_send_log", "rateLimit", "session", "user", "verification"]);
    const { rows: cols } = await getPool().query(
      `SELECT column_default, is_nullable FROM information_schema.columns WHERE table_name = 'user' AND column_name = 'status'`,
    );
    expect(cols[0]).toMatchObject({ is_nullable: "NO" });
    expect(cols[0].column_default).toContain("pending");
  });

  it("refuses an unknown status", async () => {
    await expect(insertUser({ status: "weird" })).rejects.toThrow(/check/i);
  });

  it("refuses an unknown role, and allows user, admin or none", async () => {
    await expect(insertUser({ role: "owner" })).rejects.toThrow(/check/i);
    for (const role of ["user", "admin", undefined]) await expect(insertUser({ role })).resolves.toBeTypeOf("string");
  });

  it("refuses a statusChangedBy that isn't a user, and clears it when that user is deleted", async () => {
    await expect(insertUser({ statusChangedBy: "nobody" })).rejects.toThrow(/foreign key/i);
    const boss = await insertUser({ role: "admin" });
    const ana = await insertUser({ statusChangedBy: boss });
    await getPool().query(`DELETE FROM "user" WHERE id = $1`, [boss]);
    const { rows } = await getPool().query(`SELECT "statusChangedBy" FROM "user" WHERE id = $1`, [ana]);
    expect(rows[0].statusChangedBy).toBeNull();
  });
});
