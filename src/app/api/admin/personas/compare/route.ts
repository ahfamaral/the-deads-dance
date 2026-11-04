import { CostLedger } from "@corpus/cost-ledger";
import { compareEditions, listEditions } from "@corpus/editions";
import { draftRound, saveComparison } from "@corpus/rounds";
import { TargetBody, type CompareResult } from "@/lib/persona-profile";
import { requireAdmin, unavailable } from "@/lib/server/access";
import { adminDeps, adminError, comparisonEstimateFor, resolveTarget, targetLanguageCodes } from "@/lib/server/persona-admin";
import { resolveCosts, type ResolvedCall } from "@/lib/server/pricing";
import { recordCalls } from "@/lib/server/spend";

/** Spec §34.3: scoring up to four editions can take a while; up to the function limit, as rounds. */
export const maxDuration = 300;

/**
 * Spec §34.3: the paid step. Scores each edition against the visitor questions with one ledger,
 * keeps the scores on the persona's draft round (keyed by slug, so a new persona has one too)
 * and the cost as a `compared` item. Ingest calls are logged, never charged (spec §34.9).
 */
export async function POST(request: Request) {
  let admin: Awaited<ReturnType<typeof requireAdmin>>;
  try {
    admin = await requireAdmin(request);
  } catch (err) {
    return unavailable(err);
  }
  if (admin instanceof Response) return admin;

  const contentType = request.headers.get("content-type") ?? "";
  if (!contentType.toLowerCase().startsWith("application/json")) {
    return Response.json({ error: "Expected a JSON body.", code: "invalid_request" }, { status: 415 });
  }
  const body = TargetBody.safeParse(await request.json().catch(() => null));
  if (!body.success) return Response.json({ error: "Name a persona or a Wikipedia title.", code: "invalid_request" }, { status: 400 });

  try {
    const deps = adminDeps();
    const target = await resolveTarget(body.data, deps);
    if (!target) return Response.json({ error: "No such persona.", code: "not_found" }, { status: 404 });
    if (!target.qid) {
      return Response.json({ error: "This persona has no Wikidata entry, so its editions can't be listed.", code: "no_wikidata" }, { status: 422 });
    }
    const editions = await listEditions(deps.client, target.qid, await targetLanguageCodes(target, deps));
    if (editions.length === 0) return Response.json({ error: "No Wikipedia edition was found.", code: "not_found" }, { status: 404 });
    const estimated = await comparisonEstimateFor(deps, editions.map((e) => e.chars));

    const ledger = new CostLedger();
    const record = (calls: ResolvedCall[], ingestItemId?: number) =>
      recordCalls(deps.pool, { userId: admin.id, calls, charge: false, personaSlug: target.slug, ingestItemId });
    let calls: ResolvedCall[] | null = null;
    let recorded = false;
    try {
      const scores = await compareEditions(editions, deps.scoreEditions(ledger));
      calls = await resolveCosts(ledger.calls);
      const cost = calls.reduce((sum, c) => sum + c.cost, 0);
      const roundId = await draftRound(deps.pool, target.slug, admin.id);
      const itemId = await saveComparison(deps.pool, roundId, scores, { label: "Compared editions", estimated, cost });
      await record(calls, itemId);
      recorded = true;
      const result: CompareResult = { scores, cost };
      return Response.json(result);
    } catch (err) {
      // The calls that finished were paid: they still count in spend views, without an item to hang on.
      // recordCalls is one statement, so a failed attempt above logged nothing and this can't double them.
      if (!recorded) {
        try {
          await record(calls ?? (await resolveCosts(ledger.calls)));
        } catch (logErr) {
          console.error(logErr);
        }
      }
      throw err;
    }
  } catch (err) {
    return adminError(err);
  }
}
