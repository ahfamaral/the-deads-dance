import { getPool } from "@corpus/db";
import type { SpendReport } from "@/lib/admin-spend";
import { requireAdmin, unavailable } from "@/lib/server/access";
import { keyCredit } from "@/lib/server/openrouter-credit";
import { heldEnergy, loggedSpend } from "@/lib/server/spend";

/** Spec §26.6: the credit card on /admin. OpenRouter being unreachable is credit: null, not an error. */
export async function GET(request: Request) {
  try {
    const admin = await requireAdmin(request);
    if (admin instanceof Response) return admin;
    const pool = getPool();
    const [credit, logged, held] = await Promise.all([keyCredit(), loggedSpend(pool), heldEnergy(pool)]);
    return Response.json({ credit, logged, held } satisfies SpendReport);
  } catch (err) {
    return unavailable(err);
  }
}
