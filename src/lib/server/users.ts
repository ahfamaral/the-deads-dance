import type { Pool } from "pg";
import { sendApproval } from "@/lib/server/email";

export type UserStatus = "pending" | "approved" | "rejected" | "blocked";
export type AdminUserRow = {
  id: string;
  email: string;
  role: string;
  status: UserStatus;
  createdAt: string;
  statusChangedAt: string | null;
  statusChangedByEmail: string | null;
};
export type TransitionResult = { ok: true; emailSent?: boolean } | { ok: false; reason: "not_found" | "already_changed" | "not_allowed" };

/**
 * Spec §24.3: one guarded UPDATE per change, so only the allowed transition applies, and only once.
 * Admin rows are never changed here (roles change only through the CLI).
 */
async function transition(
  pool: Pick<Pool, "query">,
  id: string,
  by: string,
  from: UserStatus,
  to: UserStatus,
  extraSet = "",
): Promise<{ ok: true; email: string } | { ok: false; reason: "not_found" | "already_changed" | "not_allowed" }> {
  const { rows } = await pool.query(
    `UPDATE "user" SET status = $3, "statusChangedAt" = now(), "statusChangedBy" = $2, "updatedAt" = now() ${extraSet}
     WHERE id = $1 AND status = $4 AND role IS DISTINCT FROM 'admin' AND id <> $2
     RETURNING email`,
    [id, by, to, from],
  );
  if (rows[0]) return { ok: true, email: rows[0].email };
  const { rows: found } = await pool.query(`SELECT role FROM "user" WHERE id = $1`, [id]);
  if (!found[0]) return { ok: false, reason: "not_found" };
  if (found[0].role === "admin" || id === by) return { ok: false, reason: "not_allowed" };
  return { ok: false, reason: "already_changed" };
}

export async function approveUser(pool: Pool, id: string, by: string): Promise<TransitionResult> {
  const r = await transition(pool, id, by, "pending", "approved");
  if (!r.ok) return r;
  try {
    await sendApproval(r.email);
    return { ok: true, emailSent: true };
  } catch (err) {
    console.error(err);
    return { ok: true, emailSent: false };
  }
}

export async function rejectUser(pool: Pool, id: string, by: string): Promise<TransitionResult> {
  const r = await transition(pool, id, by, "pending", "rejected");
  return r.ok ? { ok: true } : r;
}

/** Blocked = banned (no new session) + every session deleted (getSession doesn't check banned). */
export async function blockUser(pool: Pool, id: string, by: string): Promise<TransitionResult> {
  const client = await pool.connect();
  let failed: unknown;
  try {
    await client.query("BEGIN");
    const r = await transition(client, id, by, "approved", "blocked", `, banned = true, "banReason" = 'Blocked by admin'`);
    if (r.ok) await client.query(`DELETE FROM session WHERE "userId" = $1`, [id]);
    await client.query(r.ok ? "COMMIT" : "ROLLBACK");
    return r.ok ? { ok: true } : r;
  } catch (err) {
    failed = err;
    // On a dead connection ROLLBACK throws too; the original error is the one worth reporting.
    await client.query("ROLLBACK").catch(() => {});
    throw err;
  } finally {
    // Passing the error discards the client instead of returning a possibly broken one to the pool.
    client.release(failed instanceof Error ? failed : undefined);
  }
}

/** Back to approved, able to sign in again. No email: they weren't emailed when blocked either. */
export async function unblockUser(pool: Pool, id: string, by: string): Promise<TransitionResult> {
  const r = await transition(pool, id, by, "blocked", "approved", `, banned = false, "banReason" = NULL`);
  return r.ok ? { ok: true } : r;
}

export async function listUsers(pool: Pool): Promise<AdminUserRow[]> {
  const { rows } = await pool.query(
    `SELECT u.id, u.email, coalesce(u.role, 'user') AS role, u.status, u."createdAt", u."statusChangedAt", b.email AS "statusChangedByEmail"
     FROM "user" u LEFT JOIN "user" b ON b.id = u."statusChangedBy"
     ORDER BY u."createdAt" DESC`,
  );
  return rows.map((r) => ({
    ...r,
    createdAt: new Date(r.createdAt).toISOString(),
    statusChangedAt: r.statusChangedAt ? new Date(r.statusChangedAt).toISOString() : null,
  }));
}
