import type { Pool } from "pg";
import type { BannerThreshold } from "@/lib/energy";
import { DEFAULT_STARTING_ENERGY } from "@/lib/money";

type Queryable = Pick<Pool, "query">;

/** Spec §26.5: the deepest banner closed; only ever lowered, so an old tab can't bring one back. */
export async function markWarningRead(pool: Queryable, userId: string, threshold: BannerThreshold): Promise<void> {
  await pool.query(`UPDATE "user" SET "energyWarningRead" = $2 WHERE id = $1 AND "energyWarningRead" > $2`, [userId, threshold]);
}

/** Spec §26.6: the energy a new tester gets on approval. */
export async function readStartingEnergy(q: Queryable): Promise<number> {
  const { rows } = await q.query(`SELECT value FROM settings WHERE key = 'default_starting_energy'`);
  const n = Number(rows[0]?.value);
  return Number.isFinite(n) && n > 0 ? n : DEFAULT_STARTING_ENERGY;
}

export async function writeStartingEnergy(q: Queryable, micros: number): Promise<void> {
  await q.query(
    `INSERT INTO settings (key, value) VALUES ('default_starting_energy', $1::jsonb)
     ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value`,
    [JSON.stringify(micros)],
  );
}

/**
 * Spec §26.6: one statement: record the grant, add it to what's left (absorbing an overdraft), make the
 * new balance the full bar, and clear the read banners. The caller has checked the user exists.
 */
export async function grantEnergy(q: Queryable, userId: string, amount: number, by: string | null): Promise<{ balance: number; full: number }> {
  const { rows } = await q.query(
    `WITH g AS (INSERT INTO energy_grants (user_id, amount, granted_by) VALUES ($1, $2, $3))
     UPDATE "user" SET "energyBalance" = "energyBalance" + $2, "energyFull" = "energyBalance" + $2,
                       "energyWarningRead" = 100, "updatedAt" = now()
     WHERE id = $1 RETURNING "energyBalance", "energyFull"`,
    [userId, amount, by],
  );
  return { balance: Number(rows[0].energyBalance), full: Number(rows[0].energyFull) };
}

/** Add energy from /admin: approved testers only, never an admin row. */
export async function addEnergy(
  pool: Pool,
  userId: string,
  amount: number,
  by: string,
): Promise<{ ok: true; email: string; balance: number; full: number } | { ok: false; reason: "not_found" | "not_allowed" }> {
  const { rows } = await pool.query(`SELECT email, status, role FROM "user" WHERE id = $1`, [userId]);
  if (!rows[0]) return { ok: false, reason: "not_found" };
  if (rows[0].role === "admin" || rows[0].status !== "approved") return { ok: false, reason: "not_allowed" };
  return { ok: true, email: rows[0].email, ...(await grantEnergy(pool, userId, amount, by)) };
}
