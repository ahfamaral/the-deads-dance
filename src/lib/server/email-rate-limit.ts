import type { Pool } from "pg";

/**
 * Spec §24.4: 1 code a minute and 5 an hour per email. Better Auth only limits per IP. Records the
 * send when allowed, so a failed email still counts (spec §24.9).
 */
export async function checkAndRecordSend(pool: Pool, email: string): Promise<boolean> {
  const lower = email.trim().toLowerCase();
  const { rows } = await pool.query(
    `SELECT count(*) FILTER (WHERE sent_at > now() - interval '1 minute')::int AS minute,
            count(*)::int AS hour
     FROM otp_send_log WHERE email = $1 AND sent_at > now() - interval '1 hour'`,
    [lower],
  );
  if (rows[0].minute >= 1 || rows[0].hour >= 5) return false;
  await pool.query(`INSERT INTO otp_send_log (email) VALUES ($1)`, [lower]);
  // Housekeeping: nothing older than a day matters.
  await pool.query(`DELETE FROM otp_send_log WHERE sent_at < now() - interval '1 day'`);
  return true;
}
