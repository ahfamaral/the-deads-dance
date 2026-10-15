import { closePool, deployDatabaseUrl, describeDbError, getPool } from "../corpus/db";
import { applySchema } from "../corpus/schema";

// Spec §31.4: runs first in every Vercel build (`npm run vercel-build`). No .env there: the
// URLs come from the project's environment. A failure fails the build, so the old deploy stays.
async function main() {
  process.env.DATABASE_URL = deployDatabaseUrl();
  await applySchema(getPool());
  console.log("Schema applied.");
}

main()
  .catch((err) => {
    console.error(describeDbError(err) ?? err);
    process.exitCode = 1;
  })
  .finally(() => closePool());
