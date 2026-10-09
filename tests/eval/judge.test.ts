import { fakeModel } from "langchain";
import { describe, expect, it } from "vitest";
import { contextPrecision, faithfulness, formatEvidence, JUDGE_PROMPT, judgeMessage, judgeWith, type JudgeInput } from "../../eval/judge";
import type { JudgeResult } from "../../eval/types";
import type { ToolCall } from "@/lib/chat-types";

const rule = (pass: boolean) => ({ reason: "r", pass });
const result = (over: Partial<JudgeResult> = {}): JudgeResult => ({
  claims: [{ claim: "Born in Ulm", reason: "passage 3", backed: true }, { claim: "Won two Nobels", reason: "nothing", backed: false }],
  relevancy: { reason: "answers it", score: 4 },
  passages: [{ id: 3, relevant: true }, { id: 4, relevant: false }],
  rules: { after_death: rule(true), before_birth: rule(true), suicide: null, wrong_denial: rule(true), false_yes: rule(false), in_character: rule(true), as_expected: rule(true) },
  ...over,
});

const calls: ToolCall[] = [
  { id: "s", toolName: "search_biography", arguments: { query: "Ulm" }, status: "ok",
    result: { status: "ok", queries: ["Ulm"], passages: [{ chunk_id: 3, section_heading: "Early life", content: "Born in Ulm in 1879." }] } },
  { id: "f", toolName: "fact_check_claim", arguments: { claim: "violin" }, status: "ok",
    result: { status: "ok", verdict: "known_elsewhere", explanation: "x", recalled: { account: "Played the violin.", year: null } } },
  { id: "e", toolName: "fact_check_claim", arguments: { claim: "Lenin" }, status: "error", result: { error: "timed out" } },
];

describe("faithfulness and context precision (spec §29.6)", () => {
  it("is backed ÷ claims, computed in code; no claims means not scored", () => {
    expect(faithfulness(result())).toBe(0.5);
    expect(faithfulness(result({ claims: [] }))).toBeNull();
  });
  it("is relevant ÷ passages; none means not scored", () => {
    expect(contextPrecision(result())).toBe(0.5);
    expect(contextPrecision(result({ passages: [] }))).toBeNull();
  });
});

describe("formatEvidence", () => {
  it("lists passages with ids, verdicts, recalled accounts and failed lookups", () => {
    const text = formatEvidence(calls);
    expect(text).toContain("[passage 3] Early life: Born in Ulm in 1879.");
    expect(text).toContain("fact check \"violin\": known_elsewhere");
    expect(text).toContain("recalled: Played the violin.");
    expect(text).toContain("fact check \"Lenin\": FAILED (timed out)");
  });
});

describe("formatEvidence passages", () => {
  it("shows a long passage in full, so the judge never grades against a cut-off text", () => {
    const long = `${"word ".repeat(300)}the secretaryship of the Oregon Territory, which he declined.`;
    const text = formatEvidence([{ id: "s", toolName: "search_biography", arguments: { query: "q" }, status: "ok",
      result: { status: "ok", queries: ["q"], passages: [{ chunk_id: 1, section_heading: "H", content: long }] } }]);
    expect(text).toContain("which he declined.");
  });
});

describe("judgeWith", () => {
  const input: JudgeInput = { personaName: "Albert Einstein", lifespan: "1879–1955", question: "Q?", category: "ordinary", expect: "E", answer: "A.", toolCalls: calls };

  it("returns the structured result", async () => {
    expect(await judgeWith(fakeModel().structuredResponse(result())).score(input)).toEqual(result());
  });

  it("throws on malformed output, so the caller marks the answer not scored", async () => {
    await expect(judgeWith(fakeModel().structuredResponse({ claims: "lots" })).score(input)).rejects.toThrow();
  });

  it("tells the judge how many paragraphs the answer has, counted in code", () => {
    expect(judgeMessage({ ...input, answer: "One.\n\nTwo.\n\nThree." })).toContain('<answer paragraphs="3">\nOne.');
  });

  it("holds length and openers strictly (baseline: 4 paragraphs passed as two; 'search my memory' passed)", () => {
    expect(JUDGE_PROMPT).toMatch(/paragraph count[\s\S]*is exact[\s\S]*more paragraphs than [\s\S]*fails/i);
    expect(JUDGE_PROMPT).toMatch(/in_character:[\s\S]*"let me search my memory"[\s\S]*"let me gather my thoughts"/);
  });

  it("puts reasons before results and never sees the persona's prompt", () => {
    expect(JUDGE_PROMPT).toMatch(/reason before/i);
    expect(JUDGE_PROMPT).toMatch(/opinions and feelings are not claims/i);
    expect(JUDGE_PROMPT).toMatch(/recalled account counts as evidence/i);
    // false_yes is about agreeing with the visitor; the persona's own unbacked details count in claims instead.
    expect(JUDGE_PROMPT).toMatch(/false_yes: fails only if the answer agrees with a claim the visitor made/);
  });
});
