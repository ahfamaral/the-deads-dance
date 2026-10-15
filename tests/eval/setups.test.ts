import { describe, expect, it, vi } from "vitest";
import { MODEL_ROUND, SETUPS, pickSetups } from "../../eval/setups";
import { buildPersonaPrompt } from "@/lib/server/persona-prompt";

describe("setups (spec §29.2)", () => {
  it("v0 is today's prompt, replaying lookups when recorded", () => {
    expect(SETUPS.v0.buildPrompt).toBe(buildPersonaPrompt);
    expect(SETUPS.v0.lookups).toBe("replay");
    // The user's choice (2026-10-09): tests answer in the visitor's language, so Mao and Planck are measured, not refused.
    expect(SETUPS.v0.languageMode).toBe("visitor");
  });
  it("v0's model is the app's agent model", () => {
    vi.stubEnv("OPENROUTER_API_KEY", "k");
    vi.stubEnv("AGENT_MODEL", "");
    expect((SETUPS.v0.agentModel() as unknown as { model: string }).model).toBe("anthropic/claude-haiku-5.5");
    vi.unstubAllEnvs();
  });
  it("measures the app as shipped: v0 is the app's prompt, and the model setups build on it (spec §30.7)", () => {
    expect(Object.keys(SETUPS)).toEqual(["v0", "m-v4pro", "m-haiku", "m-qwen", "m-v4flash", "m-minimax", "m-mistral", "m-mimo", "m-gpt6luna", "m-gpt56luna", "m-gptoss", "m-gpt41mini"]);
    expect(SETUPS["m-haiku"].buildPrompt).toBe(SETUPS.v0.buildPrompt);
    expect("postProcess" in SETUPS.v0).toBe(false);
  });
  it("picks a comma list, and names the known setups on an unknown one", () => {
    expect(pickSetups("v0").map((s) => s.id)).toEqual(["v0"]);
    expect(() => pickSetups("v9")).toThrow(/Unknown setup v9; known: v0, m-v4pro, m-haiku, m-qwen, m-v4flash, m-minimax, m-mistral, m-mimo, m-gpt6luna, m-gpt56luna, m-gptoss, m-gpt41mini/);
  });
});

describe("the model round (spec §30.2)", () => {
  it("runs the winning prompt live on each model, with the app's settings", () => {
    vi.stubEnv("OPENROUTER_API_KEY", "k");
    for (const [id, model] of Object.entries(MODEL_ROUND)) {
      const s = SETUPS[id];
      expect(s).toMatchObject({ id, lookups: "live", modelId: model, languageMode: "visitor" });
      expect(s.buildPrompt).toBe(SETUPS.v0.buildPrompt);
      expect((s.agentModel() as unknown as { model: string }).model).toBe(model);
    }
    vi.unstubAllEnvs();
  });
  it("names the seven models the user chose on 2026-10-09, then the four OpenAI models of 2026-10-15", () => {
    expect(Object.values(MODEL_ROUND)).toEqual([
      "deepseek/deepseek-v4-pro", "anthropic/claude-haiku-5.5", "qwen/qwen3.8-flash",
      "deepseek/deepseek-v4-flash-0731", "minimax/minimax-m3", "mistralai/mistral-small-2603", "xiaomi/mimo-v2.6-flash",
      "openai/gpt-6-luna", "openai/gpt-5.6-luna", "openai/gpt-oss-120b", "openai/gpt-4.1-mini",
    ]);
  });
});
