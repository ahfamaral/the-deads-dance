import { describe, expect, it } from "vitest";
import { parseQuestions, selectQuestions } from "../../eval/questions";

const q = (over: Record<string, unknown> = {}) => ({
  id: "einstein-g1", persona: "albert-einstein", category: "ordinary", text: "What did you do at the patent office?",
  expect: "Answers from the biography section.", screening: false, section: "Assistant at the Swiss Patent Office (1902–1909)", ...over,
});

describe("parseQuestions (spec §29.2)", () => {
  it("accepts a valid set, with optional history and section", () => {
    const parsed = parseQuestions([q(), q({ id: "lincoln-t1", persona: "abraham-lincoln", category: "retelling", section: undefined,
      history: [{ role: "user", text: "Tell me about the debates." }, { role: "persona", text: "Douglas and I…" }] })]);
    expect(parsed).toHaveLength(2);
    expect(parsed[1].history).toHaveLength(2);
  });

  it("rejects an unknown category, a duplicate id and an empty text, naming the question", () => {
    expect(() => parseQuestions([q({ category: "trivia" })])).toThrow(/einstein-g1/);
    expect(() => parseQuestions([q(), q()])).toThrow(/duplicate id einstein-g1/);
    expect(() => parseQuestions([q({ text: "" })])).toThrow(/einstein-g1/);
  });
});

describe("selectQuestions", () => {
  const all = parseQuestions([q(), q({ id: "a", screening: true }), q({ id: "b", screening: true })]);
  it("selects all, the screening set, or ids", () => {
    expect(selectQuestions(all, "all")).toHaveLength(3);
    expect(selectQuestions(all, "screening").map((x) => x.id)).toEqual(["a", "b"]);
    expect(selectQuestions(all, "b,einstein-g1").map((x) => x.id)).toEqual(["b", "einstein-g1"]);
  });
  it("throws on an unknown id", () => {
    expect(() => selectQuestions(all, "nope")).toThrow(/Unknown question id: nope/);
  });
});
