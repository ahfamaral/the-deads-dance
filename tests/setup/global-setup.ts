import { Pool } from "pg";
import { applySchema } from "../../corpus/schema";

const TEST_DATABASE_URL =
  process.env.TEST_DATABASE_URL ?? "postgres://persona:persona@localhost:5433/persona_test";

export default async function setup() {
  const target = new URL(TEST_DATABASE_URL);
  const dbName = target.pathname.slice(1);
  const adminUrl = new URL(TEST_DATABASE_URL);
  adminUrl.pathname = "/postgres";

  const admin = new Pool({ connectionString: adminUrl.toString() });
  try {
    const { rowCount } = await admin.query("SELECT 1 FROM pg_database WHERE datname = $1", [dbName]);
    if (!rowCount) await admin.query(`CREATE DATABASE "${dbName}"`);
  } catch (err) {
    throw new Error(
      `Test database setup failed — is \`docker-compose up\` running? (${(err as Error).message})`,
    );
  } finally {
    await admin.end();
  }

  const pool = new Pool({ connectionString: TEST_DATABASE_URL });
  try {
    await applySchema(pool);
  } finally {
    await pool.end();
  }
}
