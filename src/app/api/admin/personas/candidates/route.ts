import { CandidatesQuery } from "@/lib/persona-profile";
import { requireAdmin, unavailable } from "@/lib/server/access";
import { adminDeps, adminError, listCandidates, pageMention, resolveTarget } from "@/lib/server/persona-admin";

/**
 * Spec §34.5: one page of extra-source candidates (own writings, real quotes, linked articles or
 * mentions) in one language, each with its embedding estimate. With `page={title}` (mentions only),
 * that one page as a mention instead, or why it can't be one (PageMentionResult). Free: Wikimedia reads only.
 */
export async function GET(request: Request) {
  let admin: Awaited<ReturnType<typeof requireAdmin>>;
  try {
    admin = await requireAdmin(request);
  } catch (err) {
    return unavailable(err);
  }
  if (admin instanceof Response) return admin;

  const query = CandidatesQuery.safeParse(Object.fromEntries(new URL(request.url).searchParams));
  if (!query.success) {
    const error = query.error.issues.some((i) => i.path[0] === "page")
      ? "Give a page title of up to 255 characters, without |."
      : "Give a kind, a language and a persona or a title.";
    return Response.json({ error, code: "invalid_request" }, { status: 400 });
  }
  const { kind, slug, title, language, offset, page } = query.data;

  try {
    const deps = adminDeps();
    const target = await resolveTarget(slug !== undefined ? { slug } : { title: title! }, deps);
    if (!target) return Response.json({ error: "No such persona.", code: "not_found" }, { status: 404 });
    if (!target.qid) {
      return Response.json({ error: "This persona has no Wikidata entry, so its sources can't be listed.", code: "no_wikidata" }, { status: 422 });
    }
    const withQid = { ...target, qid: target.qid };
    if (page !== undefined) return Response.json(await pageMention(deps.client, withQid, language, page));
    return Response.json(await listCandidates(deps.client, withQid, kind, language, offset));
  } catch (err) {
    return adminError(err);
  }
}
