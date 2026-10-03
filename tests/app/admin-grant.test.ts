import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { closePool, getPool } from "@corpus/db";
import { grantAdmin } from "../../scripts/admin-grant";
import { resetAuth } from "../helpers/db";

beforeEach(() => resetAuth());
afterAll(() => closePool());

describe("grantAdmin", () => {
  it("creates an approved admin, lowercasing the email", async () => {
    const { userId } = await grantAdmin(getPool(), "  Boss@Example.com ");
    const { rows } = await getPool().query(`SELECT email, role, status FROM "user" WHERE id = $1`, [userId]);
    expect(rows[0]).toEqual({ email: "boss@example.com", role: "admin", status: "approved" });
  });

  it("promotes an existing user and ends their sessions", async () => {
    await getPool().query(`INSERT INTO "user" (id, name, email, "emailVerified", role, status, banned) VALUES ('u1', '', 'boss@example.com', true, 'user', 'blocked', true)`);
    await getPool().query(`INSERT INTO session (id, "expiresAt", token, "updatedAt", "userId") VALUES ('s1', now() + interval '30 days', 't1', now(), 'u1')`);
    const { userId } = await grantAdmin(getPool(), "boss@example.com");
    expect(userId).toBe("u1");
    const { rows } = await getPool().query(`SELECT role, status, banned FROM "user" WHERE id = 'u1'`);
    expect(rows[0]).toEqual({ role: "admin", status: "approved", banned: false });
    expect((await getPool().query(`SELECT 1 FROM session WHERE "userId" = 'u1'`)).rowCount).toBe(0);
  });
});
