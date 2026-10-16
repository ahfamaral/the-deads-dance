import { getPool } from "@corpus/db";
import { requireAdmin, unavailable } from "@/lib/server/access";
import { listFeedback } from "@/lib/server/feedback";

/** Spec §32.7: every rating, newest first, and the summary, for the admin's Feedback tab. */
export async function GET(request: Request) {
  try {
    const admin = await requireAdmin(request);
    if (admin instanceof Response) return admin;
    return Response.json(await listFeedback(getPool()));
  } catch (err) {
    return unavailable(err);
  }
}
