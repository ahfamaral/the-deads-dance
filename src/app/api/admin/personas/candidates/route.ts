import { CandidatesQuery } from "@/lib/persona-profile";
import { requireAdmin, unavailable } from "@/lib/server/access";
import { adminDeps, adminError, listCandidates, resolveTarget } from "@/lib/server/persona-admin";

/**
 * Spec §34.5: one page of extra-source candidates (own writings, real quotes, linked articles or
 * mentions) in one language, each with its embedding estimate. Free: Wikimedia reads only.
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
    return Response.json({ error: "Give a kind, a language and a persona or a title.", code: "invalid_request" }, { status: 400 });
  }
  const { kind, slug, title, language, offset } = query.data;

  try {
    const deps = adminDeps();
    const target = await resolveTarget(slug !== undefined ? { slug } : { title: title! }, deps);
    if (!target) return Response.json({ error: "No such persona.", code: "not_found" }, { status: 404 });
    if (!target.qid) {
      return Response.json({ error: "This persona has no Wikidata entry, so its sources can't be listed.", code: "no_wikidata" }, { status: 422 });
    }
    return Response.json(await listCandidates(deps.client, { ...target, qid: target.qid }, kind, language, offset));
  } catch (err) {
    return adminError(err);
  }
}
