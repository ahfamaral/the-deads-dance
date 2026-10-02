import { parseArgs } from "node:util";
import type { PersonaEntry } from "../corpus/ingest";
import { normalizeLanguages, PersonaLanguagesSchema } from "../corpus/languages";
import { CharacterProfileSchema } from "../corpus/profile";

export type IngestArgs = { refresh: boolean; only: string[] };

export function parseIngestArgs(argv: string[]): IngestArgs {
  const { values, positionals } = parseArgs({
    args: argv,
    options: { refresh: { type: "boolean", default: false } },
    allowPositionals: true,
  });
  return { refresh: values.refresh ?? false, only: positionals };
}

const OPTIONAL_FIELDS = ["displayName", "description", "lifespan"] as const;

export function parseManifest(json: unknown): PersonaEntry[] {
  if (!Array.isArray(json)) throw new Error("personas.json must be an array of personas.");
  const seen = new Set<string>();
  return json.map((raw, i) => {
    const item = (raw ?? {}) as Record<string, unknown>;
    for (const field of ["slug", "wikipediaTitle"]) {
      if (typeof item[field] !== "string" || !item[field]) {
        throw new Error(`personas.json entry ${i}: "${field}" must be a non-empty string.`);
      }
    }
    for (const field of OPTIONAL_FIELDS) {
      if (item[field] !== undefined && typeof item[field] !== "string") {
        throw new Error(`personas.json entry ${i}: "${field}" must be a string.`);
      }
    }
    if (item.systemPrompt !== undefined) {
      throw new Error(`personas.json entry ${i}: "systemPrompt" was replaced by "profile" (spec §17.1).`);
    }
    let profile: PersonaEntry["profile"];
    if (item.profile !== undefined) {
      const parsed = CharacterProfileSchema.safeParse(item.profile);
      if (!parsed.success) {
        const detail = parsed.error.issues.map((issue) => `${issue.path.join(".") || "(root)"}: ${issue.message}`).join("; ");
        throw new Error(`personas.json entry ${i}: "profile" is invalid — ${detail}.`);
      }
      profile = parsed.data;
    }
    let languages: PersonaEntry["languages"];
    if (item.languages !== undefined) {
      const parsed = PersonaLanguagesSchema.safeParse(item.languages);
      if (!parsed.success) {
        const detail = parsed.error.issues.map((issue) => `${issue.path.join(".") || "(root)"}: ${issue.message}`).join("; ");
        throw new Error(`personas.json entry ${i}: "languages" is invalid — ${detail}.`);
      }
      languages = normalizeLanguages(parsed.data);
    }
    const slug = item.slug as string;
    if (seen.has(slug)) throw new Error(`personas.json: duplicate slug "${slug}".`);
    seen.add(slug);
    return {
      slug,
      wikipediaTitle: item.wikipediaTitle as string,
      origin: "curated",
      displayName: item.displayName as string | undefined,
      description: item.description as string | undefined,
      lifespan: item.lifespan as string | undefined,
      profile,
      languages,
    };
  });
}

export function selectEntries(entries: PersonaEntry[], only: string[]): PersonaEntry[] {
  if (only.length === 0) return entries;
  const known = new Set(entries.map((e) => e.slug));
  const unknown = only.filter((slug) => !known.has(slug));
  if (unknown.length) {
    throw new Error(`Unknown persona slug(s): ${unknown.join(", ")}. Known: ${[...known].join(", ")}.`);
  }
  return entries.filter((e) => only.includes(e.slug));
}
