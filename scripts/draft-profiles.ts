import { readFile } from "node:fs/promises";
import { closePool, describeDbError, getPool } from "../corpus/db";
import { profileGenerator } from "../corpus/profile";
import { parseIngestArgs, parseManifest, selectEntries } from "./ingest-args";
import { draftProfiles } from "./profile-drafts";

// Usage: npm run profiles:draft [slug…] — prints { slug: profile } JSON to paste into personas.json.
async function main() {
  const { only } = parseIngestArgs(process.argv.slice(2));
  const entries = selectEntries(parseManifest(JSON.parse(await readFile("personas.json", "utf8"))), only);
  const { profiles, failures } = await draftProfiles(
    entries.map((e) => e.slug),
    { pool: getPool(), generateProfile: profileGenerator() },
  );
  console.log(JSON.stringify(profiles, null, 2));
  for (const failure of failures) console.error(`failed   ${failure}`);
  if (failures.length) process.exitCode = 1;
}

main()
  .catch((err) => {
    console.error(describeDbError(err) ?? err);
    process.exitCode = 1;
  })
  .finally(() => closePool());
