import { getPool } from "@corpus/db";
import { parseGrant } from "@/lib/money";
import { requireAdmin, unavailable } from "@/lib/server/access";
import { readStartingEnergy, writeStartingEnergy } from "@/lib/server/energy";

/** Spec §26.6: the starting energy for new testers, in micro-dollars. */
export async function GET(request: Request) {
  try {
    const admin = await requireAdmin(request);
    if (admin instanceof Response) return admin;
    return Response.json({ startingEnergy: await readStartingEnergy(getPool()) });
  } catch (err) {
    return unavailable(err);
  }
}

export async function PUT(request: Request) {
  try {
    const admin = await requireAdmin(request);
    if (admin instanceof Response) return admin;
    const body: unknown = await request.json().catch(() => null);
    const micros = parseGrant((body as { startingEnergy?: unknown } | null)?.startingEnergy);
    if (micros === null) return Response.json({ error: "Enter an amount from 0.01 to 5.00.", code: "invalid_request" }, { status: 400 });
    await writeStartingEnergy(getPool(), micros);
    return Response.json({ startingEnergy: micros });
  } catch (err) {
    return unavailable(err);
  }
}
