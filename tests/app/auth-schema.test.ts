import { afterAll, describe, expect, it } from "vitest";
import { closePool, getPool } from "@corpus/db";

afterAll(() => closePool());

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
    await expect(
      getPool().query(`INSERT INTO "user" (id, name, email, "emailVerified", status) VALUES ('x', '', 'x@x.io', true, 'weird')`),
    ).rejects.toThrow(/check/i);
  });
});
