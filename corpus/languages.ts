import { z } from "zod";

/** Spec §18.4: the languages a persona spoke, native first. */
export const PersonaLanguageSchema = z.strictObject({
  code: z.string().regex(/^[a-z]{2}$/),
  name: z.string().trim().min(1).max(40),
  native: z.boolean(),
});
export const PersonaLanguagesSchema = z.array(PersonaLanguageSchema).max(20);
export type PersonaLanguage = z.infer<typeof PersonaLanguageSchema>;

/** The corpus is English Wikipedia, so a persona with no recorded languages is taken to speak English. */
export const FALLBACK_LANGUAGES: PersonaLanguage[] = [{ code: "en", name: "English", native: true }];

/** One entry per code (native wins), native languages first; with none native, the first becomes native. */
export function normalizeLanguages(list: PersonaLanguage[]): PersonaLanguage[] {
  const byCode = new Map<string, PersonaLanguage>();
  for (const l of list) {
    const seen = byCode.get(l.code);
    byCode.set(l.code, seen ? { ...seen, native: seen.native || l.native } : { ...l });
  }
  const merged = [...byCode.values()];
  const ordered = [...merged.filter((l) => l.native), ...merged.filter((l) => !l.native)];
  if (ordered.length && !ordered.some((l) => l.native)) ordered[0] = { ...ordered[0], native: true };
  return ordered;
}

/** Null means "not fetched yet"; empty means Wikidata records none. Both speak English (spec §18.4). */
export function languagesOrFallback(list: PersonaLanguage[] | null): PersonaLanguage[] {
  return list && list.length ? list : FALLBACK_LANGUAGES;
}

export function parseStoredLanguages(value: unknown): PersonaLanguage[] | null {
  const parsed = PersonaLanguagesSchema.safeParse(value);
  return parsed.success ? parsed.data : null;
}

export function sameLanguages(a: PersonaLanguage[] | null, b: PersonaLanguage[] | null): boolean {
  if (a === null || b === null) return a === b;
  return a.length === b.length && a.every((l, i) => l.code === b[i].code && l.name === b[i].name && l.native === b[i].native);
}

const names = new Intl.DisplayNames(["en"], { type: "language", fallback: "code" });

/** "ja" → "Japanese"; an unknown code comes back as itself. */
export function languageName(code: string): string {
  try {
    return names.of(code) ?? code;
  } catch {
    return code;
  }
}
