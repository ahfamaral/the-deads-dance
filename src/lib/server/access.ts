import { describeDbError } from "@corpus/db";
import { getAuth } from "@/lib/server/auth";
import type { UserStatus } from "@/lib/server/users";

export type CurrentUser = { id: string; email: string; role: "user" | "admin"; status: UserStatus };

/** Spec §24.5: the only place the app asks who the user is. Reads the database on every call. */
export async function currentUser(headers: Headers): Promise<CurrentUser | null> {
  const s = await getAuth().api.getSession({ headers });
  if (!s) return null;
  return {
    id: s.user.id,
    email: s.user.email,
    role: s.user.role === "admin" ? "admin" : "user",
    status: (s.user.status ?? "pending") as UserStatus,
  };
}

/** Approved users and the admin. Otherwise 401 (signed out) or 403 (pending, rejected, blocked). */
export async function requireApproved(request: Request): Promise<CurrentUser | Response> {
  const user = await currentUser(request.headers);
  if (!user) return Response.json({ error: "Sign in to continue.", code: "unauthenticated" }, { status: 401 });
  if (user.role !== "admin" && user.status !== "approved") {
    return Response.json({ error: "Your account isn't approved.", code: "not_approved" }, { status: 403 });
  }
  return user;
}

/** The admin only. Everyone else gets 404, so admin routes stay hidden. */
export async function requireAdmin(request: Request): Promise<CurrentUser | Response> {
  const user = await currentUser(request.headers);
  if (!user || user.role !== "admin") return Response.json({ error: "Not found." }, { status: 404 });
  return user;
}

/** Spec §24.9: a database outage is a 503, not a crash. For routes that don't have their own. */
export function unavailable(err: unknown): Response {
  console.error(err);
  return Response.json({ error: describeDbError(err) ?? "Server error", code: "unavailable" }, { status: 503 });
}
