import { getPool } from "@corpus/db";
import { requireApproved, unavailable } from "@/lib/server/access";
import { accessBody } from "@/lib/server/access-info";

/**
 * Whether the caller may still use the app: 200 with the screen's energy or spend (spec §26.5–6)
 * when approved (or the admin), 401 signed out (blocking deletes the sessions), 403 pending or
 * rejected. The start menu, history and export don't need the server to show, so they ask here
 * to send a blocked tester back to sign-in.
 */
export async function GET(request: Request) {
  try {
    const user = await requireApproved(request);
    if (user instanceof Response) return user;
    return Response.json(await accessBody(getPool(), user));
  } catch (err) {
    return unavailable(err); // spec §24.9: the database is down
  }
}
