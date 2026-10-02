import { readFile } from "node:fs/promises";
import { closePool, describeDbError, getPool } from "../corpus/db";
import { embeddingModel } from "../corpus/embeddings";
import { ingestPersona } from "../corpus/ingest";
import { profileGenerator } from "../corpus/profile";
import { fetchArticle, fetchPersonLanguages } from "../corpus/wikipedia";
import { parseIngestArgs, parseManifest, selectEntries } from "./ingest-args";

async function main() {
  const args = parseIngestArgs(process.argv.slice(2));
  const entries = selectEntries(parseManifest(JSON.parse(await readFile("personas.json", "utf8"))), args.only);
  const deps = {
    pool: getPool(),
    embeddings: embeddingModel(),
    fetchArticle: (title: string) => fetchArticle(title),
    generateProfile: profileGenerator(),
    fetchLanguages: (qid: string) => fetchPersonLanguages(qid),
  };

  let failures = 0;
  for (const entry of entries) {
    try {
      const result = await ingestPersona(entry, deps, {
        refresh: args.refresh,
        onProgress: (p) => {
          if (p.status === "started") console.log(`  ${entry.slug}: ${p.step}${p.chunks ? ` (${p.chunks} chunks)` : ""}`);
        },
      });
      const label =
        result.outcome === "skipped" ? "skipped " : result.outcome === "updated" ? "updated " : "ingested";
      console.log(`${label} ${entry.slug} — ${result.chunkCount} chunks`);
    } catch (err) {
      // A database problem affects every persona; stop with the hint instead of repeating it.
      const dbHint = describeDbError(err);
      if (dbHint) throw err;
      failures++;
      console.error(`failed   ${entry.slug} — ${err instanceof Error ? err.message : String(err)}`);
    }
  }
  if (failures) process.exitCode = 1;
}

main()
  .catch((err) => {
    console.error(describeDbError(err) ?? err);
    process.exitCode = 1;
  })
  .finally(() => closePool());
