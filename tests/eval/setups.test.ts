import { describe, expect, it, vi } from "vitest";
import { SETUPS, pickSetups } from "../../eval/setups";
import { buildPersonaPrompt } from "@/lib/server/persona-prompt";

describe("setups (spec §29.2)", () => {
  it("v0 is today's prompt, replaying lookups when recorded", () => {
    expect(SETUPS.v0.buildPrompt).toBe(buildPersonaPrompt);
    expect(SETUPS.v0.lookups).toBe("replay");
  });
  it("v0's model is the app's agent model", () => {
    vi.stubEnv("OPENROUTER_API_KEY", "k");
    vi.stubEnv("AGENT_MODEL", "");
    expect((SETUPS.v0.agentModel() as unknown as { model: string }).model).toBe("deepseek/deepseek-v4-pro");
    vi.unstubAllEnvs();
  });
  it("picks a comma list, and names the known setups on an unknown one", () => {
    expect(pickSetups("v0").map((s) => s.id)).toEqual(["v0"]);
    expect(() => pickSetups("v9")).toThrow(/Unknown setup v9; known: v0/);
  });
});
