import { chatModel } from "@corpus/models";
import type { LanguageMode } from "@/lib/chat-types";
import type { AgentModel } from "@/lib/server/agent";
import { buildPersonaPrompt } from "@/lib/server/persona-prompt";

/**
 * Spec §29.2: a setup is a prompt builder, the agent model, and whether lookups are replayed.
 * A replayed question with no recording runs live and is recorded (§29.4). Phase 5 adds variants here.
 */
export type Setup = {
  id: string;
  describe: string;
  buildPrompt: typeof buildPersonaPrompt;
  agentModel: () => AgentModel;
  lookups: "replay" | "live";
  /** The chat's language checkbox: "visitor" answers in the visitor's language, "realistic" only in the persona's own. */
  languageMode: LanguageMode;
};

export const SETUPS: Record<string, Setup> = {
  v0: {
    id: "v0",
    describe: "Today's prompt (§28) and models",
    buildPrompt: buildPersonaPrompt,
    agentModel: () => chatModel("agent"),
    lookups: "replay",
    // The user's choice (2026-10-09): otherwise Mao and Planck refuse English questions and can't be measured.
    languageMode: "visitor",
  },
};

export function pickSetups(ids: string): Setup[] {
  return ids.split(",").map((raw) => {
    const id = raw.trim();
    const setup = SETUPS[id];
    if (!setup) throw new Error(`Unknown setup ${id}; known: ${Object.keys(SETUPS).join(", ")}`);
    return setup;
  });
}
