import { getPool } from "@corpus/db";
import { requireAdmin, unavailable } from "@/lib/server/access";
import { approveUser, blockUser, rejectUser, unblockUser } from "@/lib/server/users";

const ACTIONS = { approve: approveUser, reject: rejectUser, block: blockUser, unblock: unblockUser } as const;
const ERRORS = { not_found: "No such user.", already_changed: "Already changed.", not_allowed: "Not allowed." } as const;

/** Spec §24.3: approve, reject, block or unblock one user, as the admin. */
export async function POST(request: Request, ctx: RouteContext<"/api/admin/users/[id]/[action]">) {
  try {
    const admin = await requireAdmin(request);
    if (admin instanceof Response) return admin;
    const { id, action } = await ctx.params;
    if (!Object.hasOwn(ACTIONS, action)) return Response.json({ error: "Not found." }, { status: 404 });
    const run = ACTIONS[action as keyof typeof ACTIONS];
    const result = await run(getPool(), id, admin.id);
    if (result.ok) return Response.json(result);
    return Response.json({ ...result, error: ERRORS[result.reason] }, { status: result.reason === "not_found" ? 404 : 409 });
  } catch (err) {
    return unavailable(err);
  }
}
