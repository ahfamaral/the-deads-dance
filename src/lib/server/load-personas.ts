import { describeDbError, getPool } from "@corpus/db";
import { listReadyPersonas } from "@corpus/personas";
import { toPersona, type Persona } from "@/lib/personas";

/** The picker's personas. A database outage renders as a notice, not an error page. */
export async function loadPersonas(): Promise<{ personas: Persona[]; unavailable: boolean }> {
  try {
    const personas = (await listReadyPersonas(getPool())).map(toPersona);
    return { personas, unavailable: false };
  } catch (err) {
    console.error(describeDbError(err) ?? err);
    return { personas: [], unavailable: true };
  }
}
