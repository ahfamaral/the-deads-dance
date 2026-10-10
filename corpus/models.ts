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
 * The agent on Claude Haiku 5.5 since 2026-10-11: Phase 5's winner (spec §30, round 4), the most faithful and
 * best-behaved persona model tested, at about half v4-pro's cost per answer. The helper and recall stay on DeepSeek
 * v4.1-flash (fast, for the 10 s classifier and recall budgets). Recall needs a model that knows well-documented
 * episodes (spec §19.2): gpt-5-mini didn't, gemini-3.8-flash did.
 */
export const DEFAULT_MODELS = {
  agent: "anthropic/claude-haiku-5.5",
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

/** Spec §28.2: the agent's cap per model call: two paragraphs plus effort "low" reasoning. A safety net; the prompt keeps replies short. */
export const AGENT_MAX_TOKENS = 900;

/** Spec §28.2: the agent's own reasoning budget, from the probe (§28.5); null keeps effort "low". */
export const AGENT_REASONING_MAX_TOKENS: number | null = null;

type Reasoning = { effort: ReasoningEffort } | { max_tokens: number };

/** An explicit AGENT_REASONING_EFFORT wins; then a budget (env, then constant); then the default effort. */
function agentReasoning(): Reasoning {
  const effort = process.env.AGENT_REASONING_EFFORT?.trim() as ReasoningEffort | undefined;
  if (effort) return { effort };
  const fromEnv = process.env.AGENT_REASONING_MAX_TOKENS?.trim();
  const budget = fromEnv && /^[1-9]\d*$/.test(fromEnv) ? Number(fromEnv) : AGENT_REASONING_MAX_TOKENS;
  return budget !== null ? { max_tokens: budget } : { effort: DEFAULT_AGENT_REASONING_EFFORT };
}

export function modelId(role: ModelRole): string {
  return process.env[ENV_VARS[role]]?.trim() || DEFAULT_MODELS[role];
}

export function chatModel(
  role: ModelRole,
  options: { timeout?: number; maxRetries?: number; reasoningEffort?: ReasoningEffort; callbacks?: BaseCallbackHandler[]; model?: string } = {},
): ChatOpenAI {
  const apiKey = process.env.OPENROUTER_API_KEY;
  if (!apiKey) {
    throw new Error("OPENROUTER_API_KEY is not set. Add it to .env.");
  }
  const settings = MODEL_SETTINGS[role];
  // Other roles keep the provider's default effort unless the call site asks (spec §20.1).
  // Spec §28.9: recall is a knowledge lookup; DeepSeek's default reasoning made it time out.
  const reasoning: Reasoning | undefined = options.reasoningEffort
    ? { effort: options.reasoningEffort }
    : role === "agent"
      ? agentReasoning()
      : role === "recall"
        ? { effort: "none" }
        : undefined;
  // Spec §28.2: a reasoning budget gets its own room on top of the reply's.
  const maxTokens = role === "agent" ? AGENT_MAX_TOKENS + (reasoning && "max_tokens" in reasoning ? reasoning.max_tokens : 0) : undefined;
  return new ChatOpenAI({
    // Spec §30.6: the eval's model round runs other persona models with the role's own settings.
    model: options.model ?? modelId(role),
    apiKey,
    configuration: { baseURL: OPENROUTER_BASE_URL },
    // Spec §17.1: the profile generator reads a whole article and needs longer than the helper's 20 s.
    timeout: options.timeout ?? settings.timeout,
    maxRetries: options.maxRetries ?? settings.maxRetries,
    ...(options.callbacks ? { callbacks: options.callbacks } : {}),
    ...(maxTokens ? { maxTokens } : {}),
    ...(reasoning ? { modelKwargs: { reasoning } } : {}),
  });
}
