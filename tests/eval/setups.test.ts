import { describe, expect, it, vi } from "vitest";
import { applyGuards } from "../../eval/guards";
import { MODEL_ROUND, SETUPS, WINNING_PROMPT, pickSetups, preflightSetups } from "../../eval/setups";
import { buildPersonaPrompt } from "@/lib/server/persona-prompt";

describe("setups (spec §29.2)", () => {
  it("v0 is today's prompt, replaying lookups when recorded", () => {
    expect(SETUPS.v0.buildPrompt).toBe(buildPersonaPrompt);
    expect(SETUPS.v0.lookups).toBe("replay");
    // The user's choice (2026-10-09): tests answer in the visitor's language, so Mao and Planck are measured, not refused.
    expect(SETUPS.v0.languageMode).toBe("visitor");
    expect(SETUPS.v0.postProcess).toBeUndefined();
  });
  it("v0's model is the app's agent model", () => {
    vi.stubEnv("OPENROUTER_API_KEY", "k");
    vi.stubEnv("AGENT_MODEL", "");
    expect((SETUPS.v0.agentModel() as unknown as { model: string }).model).toBe("anthropic/claude-haiku-5.5");
    vi.unstubAllEnvs();
  });
  it("registers F, V3, V4 and V5 with replayed lookups, the app's model and the visitor's language", () => {
    for (const id of ["f", "v3", "v4", "v5"]) {
      expect(SETUPS[id]).toMatchObject({ id, lookups: "replay", languageMode: "visitor" });
      expect(SETUPS[id].postProcess).toBe(applyGuards);
    }
  });
  it("picks a comma list, and names the known setups on an unknown one", () => {
    expect(pickSetups("v0").map((s) => s.id)).toEqual(["v0"]);
    expect(() => pickSetups("v9")).toThrow(/Unknown setup v9; known: v0, f, v3, v4, v5, m-v4pro, m-haiku, m-qwen, m-v4flash, m-minimax, m-mistral, m-mimo/);
  });
});

describe("the model round (spec §30.2)", () => {
  it("runs the winning prompt live on each model, with the app's settings", () => {
    vi.stubEnv("OPENROUTER_API_KEY", "k");
    for (const [id, model] of Object.entries(MODEL_ROUND)) {
      const s = SETUPS[id];
      expect(s).toMatchObject({ id, lookups: "live", modelId: model, languageMode: "visitor" });
      expect(s.buildPrompt).toBe(SETUPS[WINNING_PROMPT].buildPrompt);
      expect(s.postProcess).toBe(SETUPS[WINNING_PROMPT].postProcess);
      expect((s.agentModel() as unknown as { model: string }).model).toBe(model);
    }
    vi.unstubAllEnvs();
  });
  it("names the seven models the user chose on 2026-10-09 (Kimi dropped; v4-flash's July release; Mistral Small and MiMo added)", () => {
    expect(Object.values(MODEL_ROUND)).toEqual([
      "deepseek/deepseek-v4-pro", "anthropic/claude-haiku-5.5", "qwen/qwen3.8-flash",
      "deepseek/deepseek-v4-flash-0731", "minimax/minimax-m3", "mistralai/mistral-small-2603", "xiaomi/mimo-v2.6-flash",
    ]);
  });
  it("checks the voice cards before a run that needs them, not after --confirm (final review #5)", () => {
    const load = vi.fn(() => { throw new Error("eval/voice-cards.json is missing"); });
    expect(() => preflightSetups([SETUPS.v0, SETUPS.f], load)).not.toThrow();
    expect(load).not.toHaveBeenCalled();
    expect(() => preflightSetups([SETUPS.v0, SETUPS.v5], load)).toThrow(/voice-cards\.json is missing/);
  });
});
