import type { BaseCallbackHandler } from "@langchain/core/callbacks/base";
import { ChatOpenAI } from "@langchain/openai";
import { OPENROUTER_BASE_URL } from "./embeddings";

/**
 * Chat models for the persona agent and for the MCP server's helper calls (query
 * expansion, fact-check verdicts) and for recall beyond the biography (spec §19). Configurable, because a model-picker dev tool is
 * planned (spec §12); until then AGENT_MODEL / HELPER_MODEL / RECALL_MODEL override these defaults.
 * OpenRouter model ids are namespaced: "deepseek/deepseek-v4-pro", not "deepseek-v4-pro".
 */
/**
 * DeepSeek since 2026-10-07, for cost: the agent on v4-pro (the persona's voice), the helper and recall on
 * v4.1-flash (fast, for the 10 s classifier and recall budgets). Not yet checked against real turns.
 * Recall needs a model that knows well-documented episodes (spec §19.2): gpt-5-mini didn't, gemini-3.8-flash did.
 */
export const DEFAULT_MODELS = {
  agent: "deepseek/deepseek-v4-pro",
  helper: "deepseek/deepseek-v4.1-flash",
  recall: "deepseek/deepseek-v4.1-flash",
} as const;

export type ModelRole = keyof typeof DEFAULT_MODELS;

const ENV_VARS: Record<ModelRole, string> = { agent: "AGENT_MODEL", helper: "HELPER_MODEL", recall: "RECALL_MODEL" };

/**
 * F6: the MCP tool call times out client-side at 30s, but fact-check makes two sequential
 * helper calls. A slower, more patient agent model must not let the helper outlast that
 * 30s budget, so the helper gets a shorter timeout and fewer retries than the agent.
 */
const MODEL_SETTINGS: Record<ModelRole, { timeout: number; maxRetries: number }> = {
  agent: { timeout: 60_000, maxRetries: 2 },
  helper: { timeout: 20_000, maxRetries: 1 },
  // Spec §19.2: the third sequential call in fact_check_claim, after a biography check of about 10 s.
  recall: { timeout: 10_000, maxRetries: 0 },
};

/**
 * Spec §20.1: OpenRouter's unified reasoning effort. Passed in modelKwargs because ChatOpenAI's own
 * `reasoning` option is dropped for namespaced ids ("openai/gpt-5.5" fails its startsWith("gpt-5")).
 */
export type ReasoningEffort = "none" | "minimal" | "low" | "medium" | "high";

/** The agent answers in conversation, not puzzles: low effort halves its latency (spec §20.1). */
export const DEFAULT_AGENT_REASONING_EFFORT: ReasoningEffort = "low";

function agentReasoningEffort(): ReasoningEffort {
  return (process.env.AGENT_REASONING_EFFORT?.trim() as ReasoningEffort | undefined) || DEFAULT_AGENT_REASONING_EFFORT;
}

export function modelId(role: ModelRole): string {
  return process.env[ENV_VARS[role]]?.trim() || DEFAULT_MODELS[role];
}

export function chatModel(
  role: ModelRole,
  options: { timeout?: number; maxRetries?: number; reasoningEffort?: ReasoningEffort; callbacks?: BaseCallbackHandler[] } = {},
): ChatOpenAI {
  const apiKey = process.env.OPENROUTER_API_KEY;
  if (!apiKey) {
    throw new Error("OPENROUTER_API_KEY is not set. Add it to .env.");
  }
  const settings = MODEL_SETTINGS[role];
  // Other roles keep the provider's default effort unless the call site asks (spec §20.1).
  const effort = options.reasoningEffort ?? (role === "agent" ? agentReasoningEffort() : undefined);
  return new ChatOpenAI({
    model: modelId(role),
    apiKey,
    configuration: { baseURL: OPENROUTER_BASE_URL },
    // Spec §17.1: the profile generator reads a whole article and needs longer than the helper's 20 s.
    timeout: options.timeout ?? settings.timeout,
    maxRetries: options.maxRetries ?? settings.maxRetries,
    ...(options.callbacks ? { callbacks: options.callbacks } : {}),
    ...(effort ? { modelKwargs: { reasoning: { effort } } } : {}),
  });
}
