import { describeDbError } from "@corpus/db";
import { isThreshold, type Threshold } from "@/lib/energy";
import { getAuth } from "@/lib/server/auth";
import type { UserStatus } from "@/lib/server/users";

export type Energy = { balance: number; full: number; warningRead: Threshold };
export type CurrentUser = { id: string; email: string; role: "user" | "admin"; status: UserStatus; energy: Energy };

const num = (v: unknown) => {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
};

const STATUSES: readonly UserStatus[] = ["pending", "approved", "rejected", "blocked"];

/** The database CHECK allows only the four; anything else fails closed, as "rejected". */
export function parseStatus(value: unknown): UserStatus {
  if (value === undefined || value === null) return "pending";
  return STATUSES.includes(value as UserStatus) ? (value as UserStatus) : "rejected";
}

/** Spec §24.5: the only place the app asks who the user is. Reads the database on every call. */
export async function currentUser(headers: Headers): Promise<CurrentUser | null> {
  const s = await getAuth().api.getSession({ headers });
  if (!s) return null;
  return {
    id: s.user.id,
    email: s.user.email,
    role: s.user.role === "admin" ? "admin" : "user",
    status: parseStatus(s.user.status),
    energy: {
      balance: num(s.user.energyBalance),
      full: num(s.user.energyFull),
      warningRead: isThreshold(Number(s.user.energyWarningRead)) ? (Number(s.user.energyWarningRead) as Threshold) : 100,
    },
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

/**
 * Spec §24.9: a database outage is a 503, not a crash. `showMessage` passes other errors' text on
 * (a missing API key, say); use it only behind a guard, so signed-out callers never see it.
 */
export function unavailable(err: unknown, { showMessage = false } = {}): Response {
  console.error(err);
  const fallback = showMessage && err instanceof Error ? err.message : "Server error";
  return Response.json({ error: describeDbError(err) ?? fallback, code: "unavailable" }, { status: 503 });
}
