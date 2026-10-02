import type { PersonaOrigin, PersonaSummary } from "@corpus/personas";

export type Persona = {
  /** The persona's slug, e.g. "chien-shiung-wu". Saved conversations refer to it. */
  id: string;
  name: string;
  description: string;
  /** Not shown in the picker; kept for timeline and context features. */
  lifespan: string;
  /** Curated personas come from personas.json and can't be removed. */
  origin: PersonaOrigin;
};

export function toPersona(summary: PersonaSummary): Persona {
  return {
    id: summary.slug,
    name: summary.displayName,
    description: summary.description,
    lifespan: summary.lifespan,
    origin: summary.origin,
  };
}
