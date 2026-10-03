import type { Pool } from "pg";
import { closePool, describeDbError, getPool } from "../corpus/db";

/**
 * Spec §24.3: the only way to make an admin. Creates or promotes the user, approved, and ends their
 * sessions so the next sign-in gets a 3-day admin session.
 */
export async function grantAdmin(pool: Pool, email: string): Promise<{ userId: string }> {
  const lower = email.trim().toLowerCase();
  if (!/^[^@\s]+@[^@\s]+$/.test(lower)) throw new Error(`Not an email: "${email}"`);
  const { rows } = await pool.query(
    `INSERT INTO "user" (id, name, email, "emailVerified", role, status, banned, "statusChangedAt")
     VALUES ($1, '', $2, true, 'admin', 'approved', false, now())
     ON CONFLICT (email) DO UPDATE SET role = 'admin', status = 'approved', banned = false, "banReason" = NULL,
       "statusChangedAt" = now(), "statusChangedBy" = NULL, "updatedAt" = now()
     RETURNING id`,
    [crypto.randomUUID(), lower],
  );
  await pool.query(`DELETE FROM session WHERE "userId" = $1`, [rows[0].id]);
  return { userId: rows[0].id };
}

async function main() {
  const email = process.argv[2];
  if (!email) throw new Error("Usage: npm run admin:grant -- <email>");
  const { userId } = await grantAdmin(getPool(), email);
  console.log(`${email.trim().toLowerCase()} is now the admin (${userId}). Sign in again to get an admin session.`);
}

// Only when run as a script, not when imported by tests.
if (process.argv[1]?.endsWith("admin-grant.ts")) {
  main()
    .catch((err) => {
      console.error(describeDbError(err) ?? err.message ?? err);
      process.exitCode = 1;
    })
    .finally(() => closePool());
}
