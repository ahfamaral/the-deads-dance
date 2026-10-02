import { getPool } from "@corpus/db";
import { deletePersona } from "@corpus/personas";

export async function DELETE(_request: Request, ctx: RouteContext<"/api/personas/[slug]">) {
  const { slug } = await ctx.params;
  const result = await deletePersona(getPool(), slug);
  if (result === "curated") {
    return Response.json({ error: "Built-in personas can't be removed." }, { status: 403 });
  }
  if (result === "not_found") {
    return Response.json({ error: "No such persona." }, { status: 404 });
  }
  return new Response(null, { status: 204 });
}
