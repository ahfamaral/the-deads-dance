import { getPool } from "@corpus/db";
import { isThreshold } from "@/lib/energy";
import { requireApproved, unavailable } from "@/lib/server/access";
import { markWarningRead } from "@/lib/server/energy";

/** Spec §26.5: the tester closed a banner. The admin has no banners, so it's a no-op for them. */
export async function POST(request: Request) {
  try {
    const user = await requireApproved(request);
    if (user instanceof Response) return user;
    const body: unknown = await request.json().catch(() => null);
    const threshold = (body as { threshold?: unknown } | null)?.threshold;
    if (!isThreshold(threshold) || threshold === 100) {
      return Response.json({ error: "Unknown threshold.", code: "invalid_request" }, { status: 400 });
    }
    if (user.role !== "admin") await markWarningRead(getPool(), user.id, threshold);
    return new Response(null, { status: 204 });
  } catch (err) {
    return unavailable(err);
  }
}
