import { chatModel } from "@corpus/models";
import type { LanguageMode } from "@/lib/chat-types";
import type { AgentModel } from "@/lib/server/agent";
import { buildPersonaPrompt, type PromptOptions, type PromptPersona } from "@/lib/server/persona-prompt";

/**
 * Spec §29.2: a setup is a prompt builder, the agent model, and whether lookups are replayed.
 * A replayed question with no recording runs live and is recorded (§29.4). Since Phase 5 shipped (§30.7), v0 is the
 * app as it runs: prompt F, with the reply guards inside chatEvents. The tested variants F, V3, V4 and V5 are retired;
 * their runs record commit 13fa689, where they live.
 */
export type Setup = {
  id: string;
  describe: string;
  buildPrompt: (persona: PromptPersona, options: PromptOptions) => string;
  agentModel: () => AgentModel;
  lookups: "replay" | "live";
  /** The chat's language checkbox: "visitor" answers in the visitor's language, "realistic" only in the persona's own. */
  languageMode: LanguageMode;
  /** Spec §30.6: the persona model's OpenRouter id, when it isn't the app's (the model round). */
  modelId?: string;
};

const PROMPT_SETUPS: Record<string, Setup> = {
  v0: {
    id: "v0",
    describe: "The app's prompt (F since Phase 5) and models; guards in the stream",
    buildPrompt: buildPersonaPrompt,
    agentModel: () => chatModel("agent"),
    lookups: "replay",
    // The user's choice (2026-10-09): otherwise Mao and Planck refuse English questions and can't be measured.
    languageMode: "visitor",
  },
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
  // The user's addition of 2026-10-15: OpenAI models, against Haiku rerun on the same code.
  "m-gpt6luna": "openai/gpt-6-luna",
  "m-gpt56luna": "openai/gpt-5.6-luna",
  "m-gptoss": "openai/gpt-oss-120b",
  "m-gpt41mini": "openai/gpt-4.1-mini",
} as const;

function modelSetup(id: string, model: string): Setup {
  const prompt = PROMPT_SETUPS.v0;
  // Live lookups: replay serves by tool and call order, so another model asking other questions would get the wrong results (spec §30.2).
  return { ...prompt, id, describe: `${prompt.describe}, on ${model}`, agentModel: () => chatModel("agent", { model }), lookups: "live", modelId: model };
}

export const SETUPS: Record<string, Setup> = {
  ...PROMPT_SETUPS,
  ...Object.fromEntries(Object.entries(MODEL_ROUND).map(([id, model]) => [id, modelSetup(id, model)])),
};

export function pickSetups(ids: string): Setup[] {
  return ids.split(",").map((raw) => {
    const id = raw.trim();
    const setup = SETUPS[id];
    if (!setup) throw new Error(`Unknown setup ${id}; known: ${Object.keys(SETUPS).join(", ")}`);
    return setup;
  });
}
