import { z } from "zod";
import { getPool } from "@corpus/db";
import { deletePersona, setPersonaHidden } from "@corpus/personas";
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

const HideSchema = z.object({ hidden: z.boolean() });

/** 2026-10-16: hide a persona from testers' picker, or show it again. Admin only; built-in personas too. */
export async function PATCH(request: Request, ctx: RouteContext<"/api/personas/[slug]">) {
  try {
    const admin = await requireAdmin(request);
    if (admin instanceof Response) return admin;
    const { slug } = await ctx.params;
    const parsed = HideSchema.safeParse(await request.json().catch(() => null));
    if (!parsed.success) return Response.json({ error: "Expected { hidden: true | false }." }, { status: 400 });
    if (!(await setPersonaHidden(getPool(), slug, parsed.data.hidden))) {
      return Response.json({ error: "No such persona." }, { status: 404 });
    }
    return Response.json({ hidden: parsed.data.hidden });
  } catch (err) {
    return unavailable(err);
  }
}
