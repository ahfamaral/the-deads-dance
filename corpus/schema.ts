import { readFile } from "node:fs/promises";
import path from "node:path";
import type { Pool } from "pg";

/** Applies db/schema.sql. Used by the CLI and the test setup; the app never imports this. */
export async function applySchema(pool: Pool): Promise<void> {
  const sql = await readFile(path.join(process.cwd(), "db", "schema.sql"), "utf8");
  await pool.query(sql);
}
