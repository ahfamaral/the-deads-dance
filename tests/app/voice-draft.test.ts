import { describe, expect, it, vi } from "vitest";
import type { ZodType } from "zod";

const wrapped = vi.hoisted(() => ({ schema: null as unknown }));
vi.mock("@corpus/models", () => ({
  chatModel: () => ({
    withStructuredOutput: (schema: unknown) => {
      wrapped.schema = schema;
      return { invoke: async () => ({}) };
    },
  }),
}));
import type { PersonaRow } from "@corpus/personas";
import { draftVoice, helperDraftModel, sampleInstructions, turnInstructions } from "@/lib/server/voice-draft";

const einstein = {
  displayName: "Albert Einstein",
  description: "Physicist who developed relativity",
  lifespan: "1879-1955",
  languages: [
    { code: "de", native: true },
    { code: "en", native: false },
  ],
  profile: {
    temperament: "gentle, absent-minded",
    humour: "playful",
    passions: "physics",
    indifferences: "fashion",
    speech: "slow and thoughtful",
    sore_points: "nationalism",
  },
  sourceText: "x".repeat(3000) + "END",
} as unknown as PersonaRow;

const good = { description: "An elderly man with a warm, slow voice.", baseVoice: "Algenib", sex: "male" as const, sampleText: "Guten Tag. Schön, Sie zu sehen." };

describe("draftVoice", () => {
  it("builds the prompt from the persona's traits and a capped lead", async () => {
    const model = vi.fn().mockResolvedValue(good);
    const draft = await draftVoice(einstein, model);
    expect(draft).toEqual({ ...good, warning: null });
    const { system, user } = model.mock.calls[0][0];
    expect(user).toContain("Physicist who developed relativity");
    expect(user).toContain("1879-1955");
    expect(user).toContain("slow and thoughtful");
    expect(user).toContain("gentle, absent-minded");
    expect(user).toContain("German");
    expect(user).not.toContain("END");
    expect(user).toContain("x".repeat(1500));
    expect(user).not.toContain("x".repeat(1501));
    expect(system).toContain("Algenib");
  });

  it("retries once when the description names the persona, then returns it with a warning", async () => {
    const bad = { ...good, description: "Einstein had a slow voice." };
    const model = vi.fn().mockResolvedValue(bad);
    const draft = await draftVoice(einstein, model);
    expect(model).toHaveBeenCalledTimes(2);
    expect(model.mock.calls[1][0].user).toContain("einstein");
    expect(draft.warning).toBe("The description or sample mentions the persona's name. Edit it before approving.");
    expect(draft.description).toBe(bad.description);
  });

  it("accepts the retry when it is clean, and checks the sample text too", async () => {
    const model = vi.fn().mockResolvedValueOnce({ ...good, sampleText: "Ich bin Albert." }).mockResolvedValueOnce(good);
    expect(await draftVoice(einstein, model)).toEqual({ ...good, warning: null });
    expect(model).toHaveBeenCalledTimes(2);
  });

  it("retries on an unknown base voice, then throws", async () => {
    const model = vi.fn().mockResolvedValue({ ...good, baseVoice: "Nope" });
    await expect(draftVoice(einstein, model)).rejects.toThrow();
    expect(model).toHaveBeenCalledTimes(2);
  });

  it("retries once when the base voice's gender differs from the sex, then accepts a match", async () => {
    const model = vi.fn().mockResolvedValueOnce({ ...good, baseVoice: "Kore" }).mockResolvedValueOnce(good);
    expect(await draftVoice(einstein, model)).toEqual({ ...good, warning: null });
    expect(model).toHaveBeenCalledTimes(2);
    expect(model.mock.calls[1][0].user).toContain("baseVoice must be a male voice from the list.");
  });

  it("throws when the gender is still wrong after the retry", async () => {
    const model = vi.fn().mockResolvedValue({ ...good, baseVoice: "Kore" });
    await expect(draftVoice(einstein, model)).rejects.toThrow();
    expect(model).toHaveBeenCalledTimes(2);
  });

  it("returns the sex and lists the voices by gender", async () => {
    const model = vi.fn().mockResolvedValue({ ...good, baseVoice: "Kore", sex: "female" });
    expect((await draftVoice(einstein, model)).sex).toBe("female");
    const { system } = model.mock.calls[0][0];
    expect(system).toContain("Male voices:");
    expect(system).toContain("Female voices:");
  });

  it("treats a description over 600 characters as invalid", async () => {
    const model = vi.fn().mockResolvedValue({ ...good, description: "a".repeat(601) });
    await expect(draftVoice(einstein, model)).rejects.toThrow();
    expect(model).toHaveBeenCalledTimes(2);
  });

  it("trims description and sample text", async () => {
    const model = vi.fn().mockResolvedValue({ ...good, description: `  ${good.description} `, sampleText: ` ${good.sampleText}\n` });
    expect(await draftVoice(einstein, model)).toEqual({ ...good, warning: null });
  });
});

describe("instructions", () => {
  it("sampleInstructions uses the native accent line", () => {
    expect(sampleInstructions({ description: "Old man." }, einstein)).toBe(
      "Old man. Speaks German, the native language. Chatting with a guest; relaxed, natural, not narrating.",
    );
  });

  it("turnInstructions ends with the language's accent line and the relaxed sentence", () => {
    expect(turnInstructions({ description: "Old man." }, "en", einstein)).toBe(
      "Old man. Speaks English as a second language, with a noticeable German accent. Talking with a guest; relaxed and natural, not narrating.",
    );
  });
});

describe("helperDraftModel", () => {
  it("gives the model wrapper a loose schema, so invalid values reach the retry", () => {
    helperDraftModel();
    const schema = wrapped.schema as ZodType;
    expect(schema.safeParse({ description: "a".repeat(700), baseVoice: "Nope", sex: "other", sampleText: "Hi." }).success).toBe(true);
  });
});
