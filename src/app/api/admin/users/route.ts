import { getPool } from "@corpus/db";
import { requireAdmin, unavailable } from "@/lib/server/access";
import { listUsers } from "@/lib/server/users";

/** Spec §24.6: every user; the admin page groups them into tabs. */
export async function GET(request: Request) {
  try {
    const admin = await requireAdmin(request);
    if (admin instanceof Response) return admin;
    return Response.json({ users: await listUsers(getPool()) });
  } catch (err) {
    return unavailable(err);
  }
}
