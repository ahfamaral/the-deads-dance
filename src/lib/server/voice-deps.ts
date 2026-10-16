import type { BaseCallbackHandler } from "@langchain/core/callbacks/base";
import type { Pool } from "pg";
import { getPool } from "@corpus/db";
import type { PersonaRow } from "@corpus/personas";
import { resolveCosts } from "./pricing";
import { speak, type Speak } from "./tts";
import { draftVoice, helperDraftModel, type VoiceDraft } from "./voice-draft";

export type VoiceDeps = {
  pool: Pool;
  /** Spec §33.3: one helper call (two at most); its ledger handler comes in `callbacks`. */
  draftVoice: (persona: PersonaRow, callbacks: BaseCallbackHandler[]) => Promise<VoiceDraft>;
  speak: Speak;
  resolveCosts: typeof resolveCosts;
};

/** The real dependencies for the admin voice routes. Route tests replace this module. */
export function voiceDeps(): VoiceDeps {
  return {
    pool: getPool(),
    draftVoice: (persona, callbacks) => draftVoice(persona, helperDraftModel(callbacks)),
    speak,
    resolveCosts,
  };
}
