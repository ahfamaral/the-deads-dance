import { existsSync, readFileSync } from "node:fs";
import { z } from "zod";

/** Spec §30.3 V5: one card per persona, keyed by display name; reviewed by the user before any run. */
export const VoiceCardsSchema = z.record(z.string().min(1), z.string().min(1).max(700));
export type VoiceCards = z.infer<typeof VoiceCardsSchema>;

export function parseVoiceCards(raw: unknown): VoiceCards {
  return VoiceCardsSchema.parse(raw);
}

export function loadVoiceCards(path = "eval/voice-cards.json"): VoiceCards {
  if (!existsSync(path)) throw new Error(`${path} is missing. Run npm run eval:voice-cards (paid, "banana" first), then review the cards.`);
  return parseVoiceCards(JSON.parse(readFileSync(path, "utf8")));
}
