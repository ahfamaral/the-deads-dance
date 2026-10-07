import { getPool } from "@corpus/db";
import { requireApproved, unavailable } from "@/lib/server/access";
import { listConversations } from "@/lib/server/conversations";

/** Spec §25.4, §27: the user's conversations, newest first; the admin's list holds everyone's. Summaries only. */
export async function GET(request: Request) {
  try {
    const user = await requireApproved(request);
    if (user instanceof Response) return user;
    return Response.json({ conversations: await listConversations(getPool(), user.id, { all: user.role === "admin" }) });
  } catch (err) {
    return unavailable(err);
  }
}
