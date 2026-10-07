import { getPool } from "@corpus/db";
import { formatDollars, parseGrant } from "@/lib/money";
import { requireAdmin, unavailable } from "@/lib/server/access";
import { addEnergy } from "@/lib/server/energy";

/** Spec §26.6: Add energy. $0.01–$5.00 per top-up, added to what's left. */
export async function POST(request: Request, ctx: RouteContext<"/api/admin/users/[id]/energy">) {
  try {
    const admin = await requireAdmin(request);
    if (admin instanceof Response) return admin;
    const { id } = await ctx.params;
    const body: unknown = await request.json().catch(() => null);
    const amount = parseGrant((body as { amount?: unknown } | null)?.amount);
    if (amount === null) return Response.json({ error: "Enter an amount from 0.01 to 5.00.", code: "invalid_request" }, { status: 400 });
    const r = await addEnergy(getPool(), id, amount, admin.id);
    if (!r.ok) {
      return Response.json(
        { ...r, error: r.reason === "not_found" ? "No such user." : "Only approved testers get energy." },
        { status: r.reason === "not_found" ? 404 : 409 },
      );
    }
    return Response.json({ ...r, added: formatDollars(amount) });
  } catch (err) {
    return unavailable(err);
  }
}
