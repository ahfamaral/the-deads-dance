import { TargetBody } from "@/lib/persona-profile";
import { requireAdmin, unavailable } from "@/lib/server/access";
import { adminDeps, adminError, findResultFor, resolveTarget } from "@/lib/server/persona-admin";

/**
 * Spec §34.3, §34.5: the free lookup. A title runs today's add checks (a dead person, not yet
 * listed); a slug is an existing persona, for Change sources. Either way: the Wikipedia editions,
 * each priced, and what comparing them would cost.
 */
export async function POST(request: Request) {
  let admin: Awaited<ReturnType<typeof requireAdmin>>;
  try {
    admin = await requireAdmin(request);
  } catch (err) {
    return unavailable(err);
  }
  if (admin instanceof Response) return admin;

  const body = TargetBody.safeParse(await request.json().catch(() => null));
  if (!body.success) return Response.json({ error: "Enter a Wikipedia title.", code: "invalid_title" }, { status: 400 });

  try {
    const deps = adminDeps();
    const target = await resolveTarget(body.data, deps);
    if (!target) return Response.json({ error: "No such persona.", code: "not_found" }, { status: 404 });
    if (!target.qid) {
      return Response.json({ error: "This persona has no Wikidata entry, so its editions can't be listed.", code: "no_wikidata" }, { status: 422 });
    }
    return Response.json(await findResultFor({ ...target, qid: target.qid }, deps));
  } catch (err) {
    return adminError(err);
  }
}
