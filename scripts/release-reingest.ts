/**
 * Spec §34.10: the release check's reingests. For one persona it builds the round's SourcePlan from
 * the same free lookups the admin pages use (the editions, the quotes candidates, the page-by-title
 * mention), prints each item with its estimate and the total, and only with `--confirm` runs the
 * round against DATABASE_URL. Without `--confirm` no paid dependency is built or called.
 *
 * Usage: npx tsx --env-file=.env scripts/release-reingest.ts <slug> [--confirm]
 */
import type { Pool } from "pg";
import { closePool, describeDbError } from "@corpus/db";
import { planChanges, runRound, type RoundDeps, type RoundResult, type SourcePlan } from "@corpus/reingest";
import { listSources, sourceKey } from "@corpus/rounds";
import { formatDollars } from "@/lib/money";
import type { CandidateDto } from "@/lib/persona-profile";
import {
  adminDeps, findResultFor, listCandidates, pageMention, resolveTarget, roundDeps, roundTarget, type AdminDeps, type AdminTarget,
} from "@/lib/server/persona-admin";

/** What the release check ingests for one persona: one edition, its quotes if any, and named mention pages. */
export type ReleaseSpec = { language: string; quotes: boolean; mentions: readonly string[] };

/** Spec §34.10: Portuguese articles; Santos-Dumont also gets the Fluminense mention and his Portuguese quotes. */
export const RELEASE_SPECS: Record<string, ReleaseSpec> = {
  "alberto-santos-dumont": { language: "pt", quotes: true, mentions: ["Fluminense Football Club"] },
  "getulio-vargas": { language: "pt", quotes: false, mentions: [] },
};

type ExistingTarget = Extract<AdminTarget, { kind: "existing" }> & { qid: string };

export type ReleasePlan = {
  target: ExistingTarget;
  plan: SourcePlan;
  /** One line per planned change, with its estimate in micro-dollars (0 for kept and removed) and what it adds. */
  items: { line: string; estimated: number; detail: string | null }[];
  /** What this round should cost, in micro-dollars. */
  total: number;
  /** What comparing the persona's editions would cost; not part of this round. */
  compareEstimated: number;
};

/** Spec §34.5–§34.6: the round the admin would tick on the "Change sources" page, built from the free lookups. */
export async function buildReleasePlan(slug: string, spec: ReleaseSpec, deps: AdminDeps): Promise<ReleasePlan> {
  const resolved = await resolveTarget({ slug }, deps);
  if (!resolved || resolved.kind !== "existing") throw new Error(`No persona ${slug} in this database.`);
  if (!resolved.qid) throw new Error(`${slug} has no Wikidata id, so its editions can't be listed.`);
  const target: ExistingTarget = { ...resolved, qid: resolved.qid };

  const found = await findResultFor(target, deps);
  const edition = found.editions.find((e) => e.language === spec.language);
  if (!edition) throw new Error(`${slug} has no ${spec.language} Wikipedia edition among its languages.`);

  const extras: SourcePlan["extras"] = [];
  const details = new Map<string, string>();
  const add = (c: CandidateDto, detail: string) => {
    const extra = { kind: c.kind, site: c.site, language: c.language, title: c.title, estimated: c.estimated };
    extras.push(extra);
    details.set(sourceKey(extra), detail);
  };
  if (spec.quotes) {
    const quotes = await listCandidates(deps.client, target, "quotes", spec.language, 0);
    for (const q of quotes.items) add(q, `${q.count} quote${q.count === 1 ? "" : "s"}, ${q.chars.toLocaleString("en")} characters`);
  }
  for (const title of spec.mentions) {
    const mention = await pageMention(deps.client, target, spec.language, title);
    if (mention.total === 0) throw new Error(mention.message);
    const [item] = mention.items;
    add(item, `${item.chars.toLocaleString("en")} characters: ${item.preview}`);
  }

  const current = await listSources(deps.pool, target.persona.id);
  const article = { kind: "article", site: "wikipedia", language: edition.language, title: edition.title } as const;
  const articleKept = current.some((s) => sourceKey(s) === sourceKey(article));
  const plan: SourcePlan = { article, extras, articleEstimated: articleKept ? 0 : edition.estimated, redraft: false, redraftEstimated: 0 };
  details.set(sourceKey(article), `${edition.words.toLocaleString("en")} words`);

  const extraEstimates = new Map(extras.map((e) => [sourceKey(e), e.estimated]));
  const items = planChanges(current, plan).map((change) => {
    const paid = change.action === "added" || change.action === "replaced";
    const estimated = !paid ? 0 : change.ref.kind === "article" ? plan.articleEstimated : (extraEstimates.get(sourceKey(change.ref)) ?? 0);
    const replaces = change.replaces ? ` (replaces ${change.replaces.language}: ${change.replaces.title})` : "";
    const line = `${change.action} ${change.ref.kind} ${change.ref.site}:${change.ref.language}:${change.ref.title}${replaces}`;
    return { line, estimated, detail: details.get(sourceKey(change.ref)) ?? null };
  });
  return { target, plan, items, total: items.reduce((sum, i) => sum + i.estimated, 0), compareEstimated: found.compareEstimated };
}

/** The admin the round is recorded against (spend logged, never charged). */
export async function adminUserId(pool: Pick<Pool, "query">): Promise<string> {
  const { rows } = await pool.query<{ id: string }>(`SELECT id FROM "user" WHERE role = 'admin' ORDER BY "createdAt" LIMIT 1`);
  if (!rows[0]) throw new Error("No admin user in this database; run npm run admin:grant first.");
  return rows[0].id;
}

export type ReleaseDeps = {
  admin: AdminDeps;
  /** Built only after `--confirm`: the paid embeddings live here. */
  roundDeps: (adminId: string, slug: string) => RoundDeps;
  log: (line: string) => void;
  /** The personas this script knows; RELEASE_SPECS unless a test passes its own. */
  specs?: Record<string, ReleaseSpec>;
};

/** Prints the plan; with `--confirm`, runs the round. Null on a dry run. */
export async function releaseReingest(argv: string[], deps: ReleaseDeps): Promise<RoundResult | null> {
  const confirm = argv.includes("--confirm");
  const slug = argv.find((a) => !a.startsWith("--"));
  const specs = deps.specs ?? RELEASE_SPECS;
  const spec = slug ? specs[slug] : undefined;
  if (!slug || !spec) throw new Error(`Usage: scripts/release-reingest.ts <${Object.keys(specs).join("|")}> [--confirm]`);

  const { target, plan, items, total, compareEstimated } = await buildReleasePlan(slug, spec, deps.admin);
  const adminId = await adminUserId(deps.admin.pool);
  deps.log(`Round for ${target.persona.displayName} (${slug}), recorded against admin ${adminId}:`);
  for (const item of items) {
    deps.log(`  ${item.line}: about ${formatDollars(item.estimated)} (${item.estimated} micro-dollars)`);
    if (item.detail) deps.log(`    ${item.detail}`);
  }
  deps.log(`Estimated total: about ${formatDollars(total)}. No redraft of highlights or character.`);
  deps.log(`(Comparing editions, not run here: about ${formatDollars(compareEstimated)}.)`);
  if (!confirm) {
    deps.log("Dry run: nothing was spent. Add --confirm to start.");
    return null;
  }

  deps.log("Confirmed: starting now.");
  const result = await runRound(roundTarget(target), plan, adminId, deps.roundDeps(adminId, slug), (p) =>
    deps.log(`  ${p.status} ${p.label} (spent ${formatDollars(p.spent)})`),
  );
  const estimated = result.costEstimated ? " (partly estimated)" : "";
  deps.log(`Done: round ${result.roundId}, ${result.passages} passages, cost ${formatDollars(result.cost)}${estimated}.`);
  return result;
}

// Only when run as a script, not when imported by tests.
if (process.argv[1]?.endsWith("release-reingest.ts")) {
  releaseReingest(process.argv.slice(2), { admin: adminDeps(), roundDeps, log: (line) => console.log(line) })
    .catch((err) => {
      console.error(describeDbError(err) ?? (err instanceof Error ? err.message : err));
      process.exitCode = 1;
    })
    .finally(() => closePool());
}
