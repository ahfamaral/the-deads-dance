import { getPool } from "@corpus/db";
import { deletePersona } from "@corpus/personas";
import { requireAdmin, unavailable } from "@/lib/server/access";

export async function DELETE(request: Request, ctx: RouteContext<"/api/personas/[slug]">) {
  try {
    const admin = await requireAdmin(request);
    if (admin instanceof Response) return admin;
    const { slug } = await ctx.params;
    const result = await deletePersona(getPool(), slug);
    if (result === "curated") {
      return Response.json({ error: "Built-in personas can't be removed." }, { status: 403 });
    }
    if (result === "not_found") {
      return Response.json({ error: "No such persona." }, { status: 404 });
    }
    return new Response(null, { status: 204 });
  } catch (err) {
    return unavailable(err);
  }
}
