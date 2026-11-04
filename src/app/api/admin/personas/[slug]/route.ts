import { getPool } from "@corpus/db";
import { HIGHLIGHTS_EDIT_MAX, HighlightsBody } from "@/lib/persona-profile";
import { requireAdmin, unavailable } from "@/lib/server/access";
import { loadPersonaProfile, saveHighlights } from "@/lib/server/persona-admin";

const notFound = () => Response.json({ error: "No such persona.", code: "not_found" }, { status: 404 });

/** Spec §34.4: the admin's profile page data. Free: no fetch, no model call. */
export async function GET(request: Request, ctx: RouteContext<"/api/admin/personas/[slug]">) {
  try {
    const admin = await requireAdmin(request);
    if (admin instanceof Response) return admin;
    const { slug } = await ctx.params;
    const profile = await loadPersonaProfile(getPool(), slug);
    return profile ? Response.json(profile) : notFound();
  } catch (err) {
    return unavailable(err);
  }
}

/** Spec §34.4: the admin edits the biography highlights; saved as typed. */
export async function PATCH(request: Request, ctx: RouteContext<"/api/admin/personas/[slug]">) {
  try {
    const admin = await requireAdmin(request);
    if (admin instanceof Response) return admin;
    const { slug } = await ctx.params;
    const body = HighlightsBody.safeParse(await request.json().catch(() => null));
    if (!body.success) {
      return Response.json(
        { error: `Enter highlights of 1–${HIGHLIGHTS_EDIT_MAX.toLocaleString("en")} characters.`, code: "invalid_request" },
        { status: 400 },
      );
    }
    return (await saveHighlights(getPool(), slug, body.data.highlights)) ? new Response(null, { status: 204 }) : notFound();
  } catch (err) {
    return unavailable(err);
  }
}
