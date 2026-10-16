import { describeDbError, getPool } from "@corpus/db";
import { listReadyPersonas } from "@corpus/personas";
import { toPersona, type Persona } from "@/lib/personas";

/**
 * The picker's personas. A database outage renders as a notice, not an error page. Testers never
 * get a hidden persona; the admin gets every one, flagged, to show it again.
 */
export async function loadPersonas({ admin }: { admin: boolean }): Promise<{ personas: Persona[]; unavailable: boolean }> {
  try {
    const personas = (await listReadyPersonas(getPool())).filter((p) => admin || !p.hidden).map(toPersona);
    return { personas, unavailable: false };
  } catch (err) {
    console.error(describeDbError(err) ?? err);
    return { personas: [], unavailable: true };
  }
}
