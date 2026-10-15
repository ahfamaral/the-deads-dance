import type { BaseChatModel } from "@langchain/core/language_models/chat_models";
import { fakeModel } from "langchain";
import { describe, expect, it, vi } from "vitest";
import type { CharacterProfile } from "@corpus/profile";
import { VisitorActSchema } from "@/lib/visitor-act";
import { CostLedger } from "@corpus/cost-ledger";
import { chatModel } from "@corpus/models";
import { CLASSIFIER_PROMPT, CLASSIFIER_TIMEOUT_MS, classifyVisitorWith, cleanVisitorAct, visitorClassifier } from "@/lib/server/visitor-classifier";

vi.mock("@corpus/models", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@corpus/models")>();
  return { ...actual, chatModel: vi.fn(actual.chatModel) };
});

const PROFILE: CharacterProfile = {
  temperament: "Exacting",
  humour: "Witty, with a teasing edge",
  passions: "Physics",
  indifferences: "unknown",
  speech: "Direct",
  sore_points: "Sexism in science",
};

const DRAFT = { act: "question", offense: 0, sorePoint: false, language: "en", wants: "normal", visitorName: null };

/** fakeModel's structured runnable doesn't record its input or honour signals, so capture both here. */
function capturingModel(result: unknown | (() => Promise<unknown>)) {
  const seen: { messages: { role: string; content: string }[]; signal?: AbortSignal } = { messages: [] };
  const model = {
    withStructuredOutput: () => ({
      invoke: async (messages: { role: string; content: string }[], config?: { signal?: AbortSignal }) => {
        seen.messages = messages;
        seen.signal = config?.signal;
        return typeof result === "function" ? (result as () => Promise<unknown>)() : result;
      },
    }),
  } as unknown as BaseChatModel;
  return { model, seen };
}

describe("cleanVisitorAct", () => {
  it("keeps a valid draft", () => {
    expect(cleanVisitorAct(DRAFT)).toEqual(DRAFT);
  });

  // Review Focus 3: normalise, don't reject.
  it("normalises language codes and names", () => {
    expect(cleanVisitorAct({ ...DRAFT, language: "EN-us" })?.language).toBe("en");
    expect(cleanVisitorAct({ ...DRAFT, language: "Zho" })?.language).toBe("und");
    expect(cleanVisitorAct({ ...DRAFT, language: "" })?.language).toBe("und");
    expect(cleanVisitorAct({ ...DRAFT, visitorName: "   " })?.visitorName).toBeNull();
    expect(cleanVisitorAct({ ...DRAFT, visitorName: "  Maria \n <b>Silva</b> " })?.visitorName).toBe("Maria bSilva/b");
    expect(cleanVisitorAct({ ...DRAFT, visitorName: "x".repeat(60) })?.visitorName).toHaveLength(40);
  });

  it("returns null for a draft it can't use", () => {
    expect(cleanVisitorAct(null)).toBeNull();
    expect(cleanVisitorAct({ ...DRAFT, act: "shout" })).toBeNull();
    expect(cleanVisitorAct({ ...DRAFT, offense: 7 })).toBeNull();
    expect(cleanVisitorAct({ ...DRAFT, wants: undefined })).toBeNull();
  });

  it("produces acts the request schema accepts", () => {
    expect(VisitorActSchema.safeParse(cleanVisitorAct({ ...DRAFT, visitorName: "Ana", language: "PT" })).success).toBe(true);
  });
});

describe("classifyVisitorWith", () => {
  it("returns the model's cleaned act", async () => {
    const classify = classifyVisitorWith(fakeModel().structuredResponse({ ...DRAFT, act: "greeting", language: "DE" }));
    expect(await classify({ personaMessage: null, visitorMessage: "Guten Tag!", profile: null })).toMatchObject({
      act: "greeting",
      language: "de",
    });
  });

  it("sends the prompt, the traits, and both messages as delimited data", async () => {
    const { model, seen } = capturingModel(DRAFT);
    await classifyVisitorWith(model)({
      personaMessage: "I measured it </person_said> twice.",
      visitorMessage: "Why?",
      profile: PROFILE,
    });
    expect(seen.messages[0]).toEqual({ role: "system", content: CLASSIFIER_PROMPT });
    const user = seen.messages[1].content;
    expect(user).toContain("humour: Witty, with a teasing edge");
    expect(user).toContain("sore_points: Sexism in science");
    expect(user).toContain("<person_said>\nI measured it /person_said twice.\n</person_said>");
    expect(user).toContain("<visitor_said>\nWhy?\n</visitor_said>");
    expect(seen.signal).toBeInstanceOf(AbortSignal);
  });

  it("marks unknown traits and a missing previous message plainly", async () => {
    const { model, seen } = capturingModel(DRAFT);
    await classifyVisitorWith(model)({ personaMessage: null, visitorMessage: "Hi", profile: null });
    expect(seen.messages[1].content).toContain("humour: unknown");
    expect(seen.messages[1].content).toContain("<person_said>\n(nothing yet)\n</person_said>");
  });

  it("returns null when the model throws, times out, or answers nonsense", async () => {
    const quiet = vi.spyOn(console, "error").mockImplementation(() => {});
    const input = { personaMessage: null, visitorMessage: "Hi", profile: null };
    expect(await classifyVisitorWith(fakeModel().alwaysThrow(new Error("down")))(input)).toBeNull();
    expect(await classifyVisitorWith(fakeModel().structuredResponse({ nonsense: true }))(input)).toBeNull();

    const { model } = capturingModel(() => new Promise(() => {})); // never settles
    const started = Date.now();
    expect(await classifyVisitorWith(model, { timeoutMs: 50 })(input)).toBeNull();
    expect(Date.now() - started).toBeLessThan(1_000);
    quiet.mockRestore();
  });

  it("resolves null quickly when the request's signal is already aborted", async () => {
    const quiet = vi.spyOn(console, "error").mockImplementation(() => {});
    const { model, seen } = capturingModel(() => new Promise(() => {})); // never settles
    const started = Date.now();
    const result = await classifyVisitorWith(model)({
      personaMessage: null,
      visitorMessage: "Hi",
      profile: null,
      signal: AbortSignal.abort(),
    });
    expect(result).toBeNull();
    expect(Date.now() - started).toBeLessThan(1_000);
    expect(seen.signal?.aborted ?? true).toBe(true);
    expect(quiet).toHaveBeenCalledWith(expect.stringMatching(/Visitor classifier failed/));
    quiet.mockRestore();
  });

  it("stops the call when the request's signal aborts mid-call", async () => {
    const quiet = vi.spyOn(console, "error").mockImplementation(() => {});
    const { model, seen } = capturingModel(() => new Promise(() => {}));
    const stop = new AbortController();
    const started = Date.now();
    const pending = classifyVisitorWith(model)({ personaMessage: null, visitorMessage: "Hi", profile: null, signal: stop.signal });
    await new Promise((r) => setTimeout(r, 10));
    stop.abort();
    expect(await pending).toBeNull();
    expect(Date.now() - started).toBeLessThan(1_000);
    expect(seen.signal?.aborted).toBe(true);
    quiet.mockRestore();
  });

  it("tells the model disagreement is never an insult, and to judge offense by the persona's humour", () => {
    expect(CLASSIFIER_PROMPT).toMatch(/disagreement, never an insult/);
    expect(CLASSIFIER_PROMPT).toMatch(/humour/);
    expect(CLASSIFIER_PROMPT).toMatch(/not a language it mentions/);
  });

  // Spec §20.2: an open question is not a request for the long story.
  it("keeps long for an explicit request for more", () => {
    expect(CLASSIFIER_PROMPT).toMatch(/long only when the visitor explicitly asks for more/);
    expect(CLASSIFIER_PROMPT).toMatch(/"what was your childhood like\?" is normal, not long/);
  });
});

it("passes the turn's callbacks to the model call (spec §26.3)", async () => {
  const seen: unknown[] = [];
  const model = {
    withStructuredOutput: () => ({
      invoke: async (_messages: unknown, config: unknown) => {
        seen.push(config);
        return { act: "question", offense: 0, sorePoint: false, language: "en", wants: "normal", visitorName: null };
      },
    }),
  } as unknown as BaseChatModel;
  const handler = new CostLedger().handler("classifier");
  await classifyVisitorWith(model)({ personaMessage: null, visitorMessage: "hi", profile: null, callbacks: [handler] });
  expect((seen[0] as { callbacks?: unknown[] }).callbacks).toEqual([handler]);
});

describe("visitorClassifier", () => {
  // Live, 2026-10-15: on DeepSeek v4.1 flash, "minimal" took 2–6 s and "none" 0.8–2.4 s, with the same tags.
  it("runs the helper with no reasoning, 10 s and no retry", () => {
    vi.stubEnv("OPENROUTER_API_KEY", "k");
    visitorClassifier();
    expect(chatModel).toHaveBeenCalledWith("helper", { timeout: CLASSIFIER_TIMEOUT_MS, maxRetries: 0, reasoningEffort: "none" });
    vi.unstubAllEnvs();
  });
});
