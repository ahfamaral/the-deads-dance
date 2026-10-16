import type { PersonaOrigin, PersonaSummary } from "@corpus/personas";
import { voiceLanguages, type VoiceStatus } from "@/lib/voice";

export type Persona = {
  /** The persona's slug, e.g. "chien-shiung-wu". Saved conversations refer to it. */
  id: string;
  name: string;
  description: string;
  /** Not shown in the picker; kept for timeline and context features. */
  lifespan: string;
  /** Curated personas come from personas.json and can't be removed. */
  origin: PersonaOrigin;
  /** Hidden by the admin; only the admin's picker lists it. */
  hidden: boolean;
  /** Spec §33.4: language codes a voice conversation can be held in; empty unless the persona's voice is approved. */
  voiceLanguages: string[];
  /** The voice's status, for the admin's list only; null for testers and for a persona without a voice. */
  voiceStatus: VoiceStatus | null;
};

/** What the database says about a persona's voice: whether it is approved, and its status (null for none). */
export type VoiceInfo = { approved: boolean; status: VoiceStatus | null };

/** A persona without a voice, e.g. one just added. */
export const NO_VOICE: VoiceInfo = { approved: false, status: null };

export function toPersona(summary: PersonaSummary, voice: VoiceInfo): Persona {
  return {
    id: summary.slug,
    name: summary.displayName,
    description: summary.description,
    lifespan: summary.lifespan,
    origin: summary.origin,
    hidden: summary.hidden,
    voiceLanguages: voice.approved ? voiceLanguages(summary.languages) : [],
    voiceStatus: voice.status,
  };
}
