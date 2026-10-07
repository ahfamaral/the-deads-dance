import type { Pool } from "pg";
import { findPersona } from "../corpus/personas";
import type { CharacterProfile, GenerateProfile } from "../corpus/profile";

export type DraftResult = { profiles: Record<string, CharacterProfile>; failures: string[] };

/** Spec §17.1: drafts for the developer to review and pin in personas.json. Writes nothing. */
export async function draftProfiles(
  slugs: string[],
  deps: { pool: Pool; generateProfile: GenerateProfile },
): Promise<DraftResult> {
  const result: DraftResult = { profiles: {}, failures: [] };
  for (const slug of slugs) {
    const persona = await findPersona(deps.pool, slug);
    if (!persona?.sourceText) {
      result.failures.push(`${slug}: not in the database — load the personas first (make db-seed)`);
      continue;
    }
    try {
      result.profiles[slug] = await deps.generateProfile(persona.sourceText);
    } catch (err) {
      result.failures.push(`${slug}: ${err instanceof Error ? err.message : String(err)}`);
    }
  }
  return result;
}
