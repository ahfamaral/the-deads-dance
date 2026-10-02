import { closePool, describeDbError, getPool } from "../corpus/db";
import { applySchema } from "../corpus/schema";

async function main() {
  await applySchema(getPool());
  console.log("Schema applied.");
}

main()
  .catch((err) => {
    console.error(describeDbError(err) ?? err);
    process.exitCode = 1;
  })
  .finally(() => closePool());
