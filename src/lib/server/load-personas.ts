import { describeDbError, getPool } from "@corpus/db";
import { listReadyPersonas } from "@corpus/personas";
import { toPersona, type Persona } from "@/lib/personas";
import { approvedVoiceSlugs, voiceStatuses } from "@/lib/server/persona-voices";

/**
 * The picker's personas, each with its voice languages (spec §33.4). A database outage renders as a notice, not an error page. Testers never
 * get a hidden persona; the admin gets every one, flagged, to show it again.
 */
export async function loadPersonas({ admin }: { admin: boolean }): Promise<{ personas: Persona[]; unavailable: boolean }> {
  try {
    const db = getPool();
    const approved = await approvedVoiceSlugs(db);
    // Spec §33.4: only the admin sees draft voices.
    const statuses = admin ? await voiceStatuses(db) : new Map();
    const personas = (await listReadyPersonas(db))
      .filter((p) => admin || !p.hidden)
      .map((p) => toPersona(p, { approved: approved.has(p.slug), status: statuses.get(p.slug) ?? null }));
    return { personas, unavailable: false };
  } catch (err) {
    console.error(describeDbError(err) ?? err);
    return { personas: [], unavailable: true };
  }
}
