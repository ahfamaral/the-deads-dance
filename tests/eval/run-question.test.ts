import { AIMessage, fakeModel, tool } from "langchain";
import { describe, expect, it, vi } from "vitest";
import { z } from "zod";
import { questionKey } from "../../eval/lookups";
import { runQuestion, type QuestionDeps } from "../../eval/run-question";
import type { Setup } from "../../eval/setups";
import type { Question } from "../../eval/questions";
import type { Recording } from "../../eval/types";
import { buildPersonaPrompt } from "@/lib/server/persona-prompt";

const persona = { id: 1, slug: "albert-einstein", displayName: "Albert Einstein", description: "Physicist", lifespan: "1879–1955",
  profile: null, languages: [{ code: "de", name: "German" }], status: "ready" } as never;
const question: Question = { id: "q1", persona: "albert-einstein", category: "ordinary", text: "Where were you born?", expect: "Ulm.", screening: false };
const setup = (model: unknown, lookups: "replay" | "live" = "replay", languageMode: Setup["languageMode"] = "visitor"): Setup =>
  ({ id: "v0", describe: "", buildPrompt: buildPersonaPrompt, agentModel: () => model as never, lookups, languageMode });
const searchCall = new AIMessage({ content: "", tool_calls: [{ id: "t1", name: "search_biography", args: { query: "birth" }, type: "tool_call" }] });
// Shaped like an MCP tool: lockPersona reads the "mcp_structured_content" artifact and builds the envelope.
const liveSearch = tool(async () => ["ignored", [{ type: "mcp_structured_content", data: { passages: [] } }]], {
  name: "search_biography", description: "d", schema: z.object({ query: z.string() }), responseFormat: "content_and_artifact",
});
const deps = (over: Partial<QuestionDeps> = {}): QuestionDeps => ({
  classify: async () => null,
  liveTools: async () => [liveSearch as never],
  recordingFor: () => null,
  resolveCosts: async (calls) => calls.map(() => ({ cost: 1_000, inputTokens: 10, outputTokens: 5 })),
  now: (() => { let t = 0; return () => (t += 100); })(),
  ...over,
});

describe("runQuestion (spec §29.4)", () => {
  it("runs live without a recording, and returns a recording of the lookups", async () => {
    const model = fakeModel().respond(searchCall).respond(new AIMessage("In Ulm."));
    const { answer, recording } = await runQuestion(deps(), question, setup(model), persona);
    expect(answer).toMatchObject({ questionId: "q1", setupId: "v0", text: "In Ulm.", error: null, lookups: "live", truncated: false });
    expect(answer.toolCalls).toHaveLength(1);
    expect(recording?.tools).toEqual([{ name: "search_biography", args: { query: "birth" }, content: '{"passages":[]}', envelope: { ok: true, data: { passages: [] } } }]);
  });

  it("replays a saved recording without touching live tools or the classifier", async () => {
    const saved: Recording = { questionId: "q1", question: questionKey(question), act: null, tools: [{ name: "search_biography", args: { query: "x" }, content: "c", envelope: { ok: true, data: { passages: [] } } }] };
    const liveTools = vi.fn(async () => null);
    const classify = vi.fn(async () => null);
    const model = fakeModel().respond(searchCall).respond(new AIMessage("In Ulm."));
    const { answer, recording } = await runQuestion(deps({ liveTools, classify, recordingFor: () => saved }), question, setup(model), persona);
    expect(answer.lookups).toBe("replay");
    expect(answer.toolCalls[0].result).toEqual({ passages: [] });
    expect(recording).toBeNull();
    expect(liveTools).not.toHaveBeenCalled();
    expect(classify).not.toHaveBeenCalled();
  });

  it("runs live again when the question changed since it was recorded", async () => {
    const stale: Recording = { questionId: "q1", question: "Where were you born, Albert?", act: null, tools: [] };
    const model = fakeModel().respond(new AIMessage("In Ulm."));
    const { answer, recording } = await runQuestion(deps({ recordingFor: () => stale }), question, setup(model), persona);
    expect(answer.lookups).toBe("live");
    expect(recording?.question).toBe(questionKey(question));
  });

  it("adds up cost and tokens from the priced calls", async () => {
    const model = fakeModel().respond(new AIMessage("In Ulm."));
    const { answer } = await runQuestion(deps(), question, setup(model), persona);
    expect(answer.answerMicros).toBeGreaterThan(0);
    expect(answer.inputTokens).toBe(answer.answerMicros / 1_000 * 10);
  });

  it("records a turn that fails as an error, not a throw, and saves no recording of it", async () => {
    const model = fakeModel().respond(new Error("429 Too Many Requests"));
    const { answer, recording } = await runQuestion(deps(), question, setup(model), persona);
    expect(answer.text).toBeNull();
    expect(answer.error).toMatch(/rate-limited|unavailable/);
    expect(recording).toBeNull();
  });

  it("never throws when the classifier throws: an error answer, no recording", async () => {
    const model = fakeModel().respond(new AIMessage("In Ulm."));
    const { answer, recording } = await runQuestion(deps({ classify: async () => { throw new Error("db down"); } }), question, setup(model), persona);
    expect(answer).toMatchObject({ text: null, error: "db down" });
    expect(recording).toBeNull();
  });

  it("treats a down MCP server as an error, not a tool-less turn", async () => {
    const model = fakeModel().respond(new AIMessage("In Ulm."));
    const { answer, recording } = await runQuestion(deps({ liveTools: async () => null }), question, setup(model), persona);
    expect(answer).toMatchObject({ text: null, error: "The MCP server is unavailable." });
    expect(recording).toBeNull();
    expect(model.calls).toHaveLength(0);
  });

  it("saves no recording when a lookup failed, so replays never inherit the failure", async () => {
    const failing = tool(async () => ["ignored", [{ type: "mcp_structured_content", data: { status: "unavailable", reason: "timeout" } }]], {
      name: "search_biography", description: "d", schema: z.object({ query: z.string() }), responseFormat: "content_and_artifact",
    });
    const model = fakeModel().respond(searchCall).respond(new AIMessage("I don't recall."));
    const { answer, recording } = await runQuestion(deps({ liveTools: async () => [failing as never] }), question, setup(model), persona);
    expect(answer.text).toBe("I don't recall.");
    expect(recording).toBeNull();
  });

  it("still counts the money when pricing fails: unpriced calls at the default live-answer cost", async () => {
    const model = fakeModel().respond(new AIMessage("In Ulm."));
    const { answer } = await runQuestion(deps({ resolveCosts: async () => { throw new Error("no price list"); } }), question, setup(model), persona);
    expect(answer.text).toBe("In Ulm.");
    expect(answer.answerMicros).toBeGreaterThanOrEqual(4_400);
  });

  it("notes a reply cut off by max_tokens", async () => {
    const model = fakeModel().respond(new AIMessage({ content: "I was born in Ulm. Then we", response_metadata: { finish_reason: "length" } }));
    const { answer } = await runQuestion(deps(), question, setup(model), persona);
    expect(answer).toMatchObject({ truncated: true, text: "I was born in Ulm." });
  });

  it("passes the question's history to the persona", async () => {
    const model = fakeModel().respond(new AIMessage("As I said."));
    await runQuestion(deps(), { ...question, history: [{ role: "user", text: "Earlier?" }, { role: "persona", text: "Yes." }] }, setup(model), persona);
    expect(JSON.stringify(model.calls)).toContain("Earlier?");
  });

  it("answers in the visitor's language when the setup says so, as the chat's checkbox does", async () => {
    const english = { act: "question", offense: 0, sorePoint: false, language: "en", wants: "normal", visitorName: null } as const;
    const prompts: string[] = [];
    const capture = (mode: Setup["languageMode"]): Setup => ({
      ...setup(fakeModel().respond(new AIMessage("In Ulm.")), "live", mode),
      buildPrompt: (p, o) => (prompts.push(o.state ?? ""), buildPersonaPrompt(p, o)),
    });
    await runQuestion(deps({ classify: async () => english }), question, capture("visitor"), persona);
    await runQuestion(deps({ classify: async () => english }), question, capture("realistic"), persona);
    expect(prompts[0]).toMatch(/Answer in English, even though you never spoke it/);
    expect(prompts[1]).toMatch(/you cannot understand what they wrote/);
  });
});
