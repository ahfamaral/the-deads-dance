import { chatModel } from "@corpus/models";
import type { LanguageMode } from "@/lib/chat-types";
import type { AgentModel } from "@/lib/server/agent";
import { buildPersonaPrompt, type PromptOptions, type PromptPersona } from "@/lib/server/persona-prompt";
import { applyGuards } from "./guards";
import { buildPromptF } from "./prompts/f";
import { buildPromptV3 } from "./prompts/v3";
import { buildPromptV4 } from "./prompts/v4";
import { buildPromptV5With } from "./prompts/v5";
import { loadVoiceCards, type VoiceCards } from "./voice-cards";

/**
 * Spec §29.2: a setup is a prompt builder, the agent model, and whether lookups are replayed.
 * A replayed question with no recording runs live and is recorded (§29.4). Phase 5 adds variants here.
 */
export type Setup = {
  id: string;
  describe: string;
  buildPrompt: (persona: PromptPersona, options: PromptOptions) => string;
  agentModel: () => AgentModel;
  lookups: "replay" | "live";
  /** The chat's language checkbox: "visitor" answers in the visitor's language, "realistic" only in the persona's own. */
  languageMode: LanguageMode;
  /** Spec §30.3: guards applied to the finished reply before checks and the judge. */
  postProcess?: (text: string) => string;
  /** Spec §30.6: the persona model's OpenRouter id, when it isn't the app's (the model round). */
  modelId?: string;
};

let cards: VoiceCards | null = null; // read on first use, so a missing file only matters when v5 runs
const v5Prompt: Setup["buildPrompt"] = (persona, options) => buildPromptV5With((cards ??= loadVoiceCards()))(persona, options);

const PROMPT_SETUPS: Record<string, Setup> = {
  v0: {
    id: "v0",
    describe: "Today's prompt (§28) and models",
    buildPrompt: buildPersonaPrompt,
    agentModel: () => chatModel("agent"),
    lookups: "replay",
    // The user's choice (2026-10-09): otherwise Mao and Planck refuse English questions and can't be measured.
    languageMode: "visitor",
  },
  f: { id: "f", describe: "F: targeted fixes on v0 (§30.3)", buildPrompt: buildPromptF, agentModel: () => chatModel("agent"), lookups: "replay", languageMode: "visitor", postProcess: applyGuards },
  v3: { id: "v3", describe: "V3: hard rules plus a recap (§30.3)", buildPrompt: buildPromptV3, agentModel: () => chatModel("agent"), lookups: "replay", languageMode: "visitor", postProcess: applyGuards },
  v4: { id: "v4", describe: "V4: led by examples (§30.3)", buildPrompt: buildPromptV4, agentModel: () => chatModel("agent"), lookups: "replay", languageMode: "visitor", postProcess: applyGuards },
  v5: { id: "v5", describe: "V5: a voice card per persona (§30.3)", buildPrompt: v5Prompt, agentModel: () => chatModel("agent"), lookups: "replay", languageMode: "visitor", postProcess: applyGuards },
};

/**
 * Spec §30.2: the persona models screened in round 3, by setup id. The user's list of 2026-10-09, after checking
 * benchmarks: Kimi K2.6 dropped (dearest, no quality edge), v4-flash's July release, Mistral Small and MiMo added.
 */
export const MODEL_ROUND = {
  "m-v4pro": "deepseek/deepseek-v4-pro",
  "m-haiku": "anthropic/claude-haiku-5.5",
  "m-qwen": "qwen/qwen3.8-flash",
  "m-v4flash": "deepseek/deepseek-v4-flash-0731",
  "m-minimax": "minimax/minimax-m3",
  "m-mistral": "mistralai/mistral-small-2603",
  "m-mimo": "xiaomi/mimo-v2.6-flash",
} as const;

/** Spec §30.5: the prompt setup the model round uses; set from round 2's result. */
export const WINNING_PROMPT: string = "f";

function modelSetup(id: string, model: string): Setup {
  const prompt = PROMPT_SETUPS[WINNING_PROMPT];
  // Live lookups: replay serves by tool and call order, so another model asking other questions would get the wrong results (spec §30.2).
  return { ...prompt, id, describe: `${prompt.describe}, on ${model}`, agentModel: () => chatModel("agent", { model }), lookups: "live", modelId: model };
}

export const SETUPS: Record<string, Setup> = {
  ...PROMPT_SETUPS,
  ...Object.fromEntries(Object.entries(MODEL_ROUND).map(([id, model]) => [id, modelSetup(id, model)])),
};

/** Final review #5: a run that needs the voice cards fails at the dry run, not after --confirm. */
export function preflightSetups(setups: Setup[], load: () => VoiceCards = loadVoiceCards): void {
  if (setups.some((s) => s.buildPrompt === v5Prompt)) cards = load();
}

export function pickSetups(ids: string): Setup[] {
  return ids.split(",").map((raw) => {
    const id = raw.trim();
    const setup = SETUPS[id];
    if (!setup) throw new Error(`Unknown setup ${id}; known: ${Object.keys(SETUPS).join(", ")}`);
    return setup;
  });
}
