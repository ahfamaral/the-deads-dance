import { requireApproved, unavailable } from "@/lib/server/access";

/**
 * Whether the caller may still use the app: 204 when approved (or the admin), 401 signed out
 * (blocking deletes the sessions), 403 pending or rejected. The start menu, history and export
 * work from localStorage, so they ask here to send a blocked tester back to sign-in.
 */
export async function GET(request: Request) {
  let user: Awaited<ReturnType<typeof requireApproved>>;
  try {
    user = await requireApproved(request);
  } catch (err) {
    return unavailable(err); // spec §24.9: the database is down
  }
  if (user instanceof Response) return user;
  return new Response(null, { status: 204 });
}
