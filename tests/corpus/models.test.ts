import { ChatOpenAI } from "@langchain/openai";
import { afterEach, describe, expect, it, vi } from "vitest";
import { AGENT_MAX_TOKENS, DEFAULT_MODELS, chatModel, modelId } from "../../corpus/models";

// AsyncCaller#maxRetries is `protected` in its .d.ts; there's no public accessor, so read it
// the way the brief allows ("whatever the installed class exposes").
function maxRetriesOf(model: ChatOpenAI): number {
  return (model.caller as unknown as { maxRetries: number }).maxRetries;
}

afterEach(() => vi.unstubAllEnvs());

describe("modelId", () => {
  it("falls back to the defaults", () => {
    vi.stubEnv("AGENT_MODEL", "");
    vi.stubEnv("HELPER_MODEL", "");
    expect(modelId("agent")).toBe(DEFAULT_MODELS.agent);
    expect(modelId("helper")).toBe(DEFAULT_MODELS.helper);
  });

  it("defaults to DeepSeek: v4-pro for the agent, v4.1-flash for the helper and recall", () => {
    expect(DEFAULT_MODELS).toEqual({
      agent: "deepseek/deepseek-v4-pro",
      helper: "deepseek/deepseek-v4.1-flash",
      recall: "deepseek/deepseek-v4.1-flash",
    });
  });

  it("defaults recall and reads RECALL_MODEL", () => {
    vi.stubEnv("RECALL_MODEL", "");
    expect(modelId("recall")).toBe(DEFAULT_MODELS.recall);
    vi.stubEnv("RECALL_MODEL", "openai/gpt-5.5");
    expect(modelId("recall")).toBe("openai/gpt-5.5");
  });

  it("reads AGENT_MODEL and HELPER_MODEL", () => {
    vi.stubEnv("AGENT_MODEL", "anthropic/claude-sonnet-5");
    vi.stubEnv("HELPER_MODEL", " openai/gpt-5-nano ");
    expect(modelId("agent")).toBe("anthropic/claude-sonnet-5");
    expect(modelId("helper")).toBe("openai/gpt-5-nano");
  });
});

describe("chatModel", () => {
  it("needs OPENROUTER_API_KEY", () => {
    vi.stubEnv("OPENROUTER_API_KEY", "");
    expect(() => chatModel("agent")).toThrow(/OPENROUTER_API_KEY/);
  });

  it("takes another model id for the agent and keeps the agent's settings (spec §30.6)", () => {
    vi.stubEnv("OPENROUTER_API_KEY", "test-key");
    vi.stubEnv("AGENT_REASONING_EFFORT", "");
    vi.stubEnv("AGENT_REASONING_MAX_TOKENS", "");
    const model = chatModel("agent", { model: "anthropic/claude-haiku-5.5" });
    expect(model.model).toBe("anthropic/claude-haiku-5.5");
    expect(model.maxTokens).toBe(AGENT_MAX_TOKENS);
    expect(model.timeout).toBe(60_000);
    expect(model.modelKwargs).toEqual({ reasoning: { effort: "low" } });
  });

  it("builds a ChatOpenAI for the role's model", () => {
    vi.stubEnv("OPENROUTER_API_KEY", "test-key");
    vi.stubEnv("HELPER_MODEL", "");
    const model = chatModel("helper");
    expect(model).toBeInstanceOf(ChatOpenAI);
    expect(model.model).toBe(DEFAULT_MODELS.helper);
  });

  // F6: the MCP tool call times out client-side at 30s and fact-check makes two sequential
  // helper calls, so the helper needs a shorter timeout/fewer retries than the agent, which
  // can afford to wait the full 60s.
  it("gives the helper a shorter timeout and fewer retries than the agent", () => {
    vi.stubEnv("OPENROUTER_API_KEY", "test-key");
    const agent = chatModel("agent");
    const helper = chatModel("helper");
    expect(agent.timeout).toBe(60_000);
    expect(maxRetriesOf(agent)).toBe(2);
    expect(helper.timeout).toBe(20_000);
    expect(maxRetriesOf(helper)).toBe(1);
  });

  // Spec §19.2: recall is the third sequential call in fact_check_claim, inside the 30 s tool timeout.
  it("gives recall 10 s and no retry", () => {
    vi.stubEnv("OPENROUTER_API_KEY", "test-key");
    const recall = chatModel("recall");
    expect(recall.timeout).toBe(10_000);
    expect(maxRetriesOf(recall)).toBe(0);
  });

  it("takes a timeout override and keeps the role's retries (spec §17.1)", () => {
    vi.stubEnv("OPENROUTER_API_KEY", "test-key");
    const slow = chatModel("helper", { timeout: 90_000 });
    expect(slow.timeout).toBe(90_000);
    expect(maxRetriesOf(slow)).toBe(1);
    expect(chatModel("helper").timeout).toBe(20_000);
    expect(chatModel("helper", {}).timeout).toBe(20_000);
  });

  // Final review: a retried 90 s profile call could keep the add form waiting ~3 minutes.
  it("lets a caller turn retries off", () => {
    vi.stubEnv("OPENROUTER_API_KEY", "test-key");
    expect(maxRetriesOf(chatModel("helper", { timeout: 90_000, maxRetries: 0 }))).toBe(0);
    expect(maxRetriesOf(chatModel("helper"))).toBe(1);
  });
});

// Spec §20.1: ChatOpenAI drops its own `reasoning` option for "openai/…" ids, so the effort
// travels as OpenRouter's unified field in modelKwargs.
describe("chatModel reasoning effort", () => {
  it("defaults the agent to low effort", () => {
    vi.stubEnv("OPENROUTER_API_KEY", "test-key");
    vi.stubEnv("AGENT_REASONING_EFFORT", "");
    vi.stubEnv("AGENT_REASONING_MAX_TOKENS", "");
    expect(chatModel("agent").modelKwargs).toEqual({ reasoning: { effort: "low" } });
  });

  it("reads AGENT_REASONING_EFFORT", () => {
    vi.stubEnv("OPENROUTER_API_KEY", "test-key");
    vi.stubEnv("AGENT_REASONING_EFFORT", " medium ");
    expect(chatModel("agent").modelKwargs).toEqual({ reasoning: { effort: "medium" } });
  });

  it("leaves the helper at the provider's default unless asked", () => {
    vi.stubEnv("OPENROUTER_API_KEY", "test-key");
    expect(chatModel("helper").modelKwargs ?? {}).toEqual({});
    expect(chatModel("helper", { reasoningEffort: "minimal" }).modelKwargs).toEqual({ reasoning: { effort: "minimal" } });
  });

  // Spec §28.9: recall is a knowledge lookup; DeepSeek's default reasoning made it time out.
  it("turns reasoning off for recall unless asked", () => {
    vi.stubEnv("OPENROUTER_API_KEY", "test-key");
    expect(chatModel("recall").modelKwargs).toEqual({ reasoning: { effort: "none" } });
    expect(chatModel("recall", { reasoningEffort: "low" }).modelKwargs).toEqual({ reasoning: { effort: "low" } });
  });
});

// Spec §28.2: max_tokens is the agent's safety net; a reasoning budget, when set, replaces effort "low".
describe("chatModel output limits", () => {
  // The Chat Completions request body; the union type also covers the Responses API, which has no max_tokens.
  const params = (role: "agent" | "helper" | "recall") => chatModel(role).invocationParams() as { max_tokens?: number };

  it("caps the agent and leaves the helper and recall alone", () => {
    vi.stubEnv("OPENROUTER_API_KEY", "test-key");
    vi.stubEnv("AGENT_REASONING_EFFORT", "");
    vi.stubEnv("AGENT_REASONING_MAX_TOKENS", "");
    expect(params("agent").max_tokens).toBe(AGENT_MAX_TOKENS);
    expect(params("helper").max_tokens).toBeUndefined();
    expect(params("recall").max_tokens).toBeUndefined();
  });

  it("gives the agent a reasoning budget instead of effort, and room for the reply on top", () => {
    vi.stubEnv("OPENROUTER_API_KEY", "test-key");
    vi.stubEnv("AGENT_REASONING_EFFORT", "");
    vi.stubEnv("AGENT_REASONING_MAX_TOKENS", "300");
    expect(chatModel("agent").modelKwargs).toEqual({ reasoning: { max_tokens: 300 } });
    expect(params("agent").max_tokens).toBe(AGENT_MAX_TOKENS + 300);
  });

  it("lets an explicit effort win over a budget", () => {
    vi.stubEnv("OPENROUTER_API_KEY", "test-key");
    vi.stubEnv("AGENT_REASONING_EFFORT", "medium");
    vi.stubEnv("AGENT_REASONING_MAX_TOKENS", "300");
    expect(chatModel("agent").modelKwargs).toEqual({ reasoning: { effort: "medium" } });
    expect(params("agent").max_tokens).toBe(AGENT_MAX_TOKENS);
  });

  it("ignores a budget that isn't a positive integer", () => {
    vi.stubEnv("OPENROUTER_API_KEY", "test-key");
    vi.stubEnv("AGENT_REASONING_EFFORT", "");
    for (const bad of ["0", "-5", "abc", "1.5"]) {
      vi.stubEnv("AGENT_REASONING_MAX_TOKENS", bad);
      expect(chatModel("agent").modelKwargs).toEqual({ reasoning: { effort: "low" } });
      expect(params("agent").max_tokens).toBe(AGENT_MAX_TOKENS);
    }
  });
});
