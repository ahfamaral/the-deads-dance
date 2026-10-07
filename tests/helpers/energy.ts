import { getPool } from "@corpus/db";

/** Sets a user's energy directly, in micro-dollars, as grants and turns would have left it. */
export async function giveEnergy(userId: string, balance: number, full = balance): Promise<void> {
  await getPool().query(`UPDATE "user" SET "energyBalance" = $2, "energyFull" = $3 WHERE id = $1`, [userId, balance, full]);
}
