import type { Pool } from "pg";

/**
 * Spec §24.4: 1 code a minute and 5 an hour per email. Better Auth only limits per IP. Records the
 * send when allowed, so a failed email still counts (spec §24.9). A per-email lock makes the check
 * and the insert one step, so concurrent sends for one email can't all pass.
 */
export async function checkAndRecordSend(pool: Pool, email: string): Promise<boolean> {
  const lower = email.trim().toLowerCase();
  const client = await pool.connect();
  let failed: unknown;
  try {
    await client.query("BEGIN");
    await client.query(`SELECT pg_advisory_xact_lock(hashtext('otp_send_log:' || $1))`, [lower]);
    const { rows } = await client.query(
      `SELECT count(*) FILTER (WHERE sent_at > now() - interval '1 minute')::int AS minute,
              count(*)::int AS hour
       FROM otp_send_log WHERE email = $1 AND sent_at > now() - interval '1 hour'`,
      [lower],
    );
    const allowed = rows[0].minute < 1 && rows[0].hour < 5;
    if (allowed) await client.query(`INSERT INTO otp_send_log (email) VALUES ($1)`, [lower]);
    await client.query("COMMIT");
    // Housekeeping, outside the lock: nothing older than a day matters.
    if (allowed) await client.query(`DELETE FROM otp_send_log WHERE sent_at < now() - interval '1 day'`);
    return allowed;
  } catch (err) {
    failed = err;
    await client.query("ROLLBACK").catch(() => {});
    throw err;
  } finally {
    client.release(failed instanceof Error ? failed : undefined);
  }
}
