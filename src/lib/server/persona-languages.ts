import { languagesOrFallback, type PersonaLanguage } from "@corpus/languages";
import { storeLanguages, type PersonaRow, type Queryable } from "@corpus/personas";

/** Runs alongside the classifier, so it must not hold the turn up for longer (spec §18.4). */
export const LANGUAGE_BACKFILL_TIMEOUT_MS = 5_000;

type LanguageDeps = {
  pool: Queryable;
  /** Real version: fetchPersonLanguages (Wikidata P103/P1412). */
  fetchLanguages: (qid: string) => Promise<PersonaLanguage[]>;
};

/**
 * Spec §18.4 backfill: a persona added before languages existed has none stored (null), so it
 * would read as English only. The first chat turn fetches them from Wikidata and stores them.
 * Never throws: a failed or slow lookup answers with the fallback, and the next turn retries.
 */
export async function languagesFor(
  persona: Pick<PersonaRow, "id" | "slug" | "wikidataQid" | "languages" | "storedLanguages">,
  deps: LanguageDeps,
  timeoutMs = LANGUAGE_BACKFILL_TIMEOUT_MS,
): Promise<PersonaLanguage[]> {
  if (persona.storedLanguages !== null || !persona.wikidataQid) return persona.languages;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error(`timed out after ${timeoutMs} ms`)), timeoutMs);
  });
  try {
    const fetched = await Promise.race([deps.fetchLanguages(persona.wikidataQid), timeout]);
    await storeLanguages(deps.pool, persona.id, fetched);
    return languagesOrFallback(fetched);
  } catch (err) {
    console.error(`Languages for ${persona.slug} failed; retrying on the next turn. ${err instanceof Error ? err.message : String(err)}`);
    return persona.languages;
  } finally {
    clearTimeout(timer);
  }
}
