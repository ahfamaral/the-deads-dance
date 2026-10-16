import { describe, expect, it } from "vitest";
import { canSend, COMMENT_MAX, FeedbackInputSchema, starsText, summarizeFeedback } from "@/lib/feedback";

describe("FeedbackInputSchema (spec §32.3)", () => {
  const parse = (v: unknown) => FeedbackInputSchema.safeParse(v);

  it("takes stars 1 to 5 and defaults a missing comment to ''", () => {
    expect(parse({ stars: 1 }).data).toEqual({ stars: 1, comment: "" });
    expect(parse({ stars: 5, comment: "Lovely" }).data).toEqual({ stars: 5, comment: "Lovely" });
  });

  it("refuses stars that aren't a whole number from 1 to 5", () => {
    for (const stars of [0, 6, 3.5, "4", null]) expect(parse({ stars }).success).toBe(false);
    expect(parse(null).success).toBe(false);
  });

  // Review Focus 2: trimmed first, so spaces don't count and a blank comment is ''.
  it("trims the comment, then refuses one over COMMENT_MAX instead of cutting it", () => {
    expect(parse({ stars: 3, comment: "   " }).data?.comment).toBe("");
    expect(parse({ stars: 3, comment: `  ${"x".repeat(COMMENT_MAX)}  ` }).data?.comment).toHaveLength(COMMENT_MAX);
    expect(parse({ stars: 3, comment: "x".repeat(COMMENT_MAX + 1) }).success).toBe(false);
    expect(parse({ stars: 3, comment: 42 }).success).toBe(false);
  });
});

describe("canSend", () => {
  it("needs a star, and a comment within the limit", () => {
    expect(canSend(null, "")).toBe(false);
    expect(canSend(4, "")).toBe(true);
    expect(canSend(4, "x".repeat(COMMENT_MAX + 1))).toBe(false);
  });
});

describe("starsText", () => {
  it("draws filled and empty stars", () => {
    expect(starsText(4)).toBe("★★★★☆");
    expect(starsText(1)).toBe("★☆☆☆☆");
  });
});

describe("summarizeFeedback (spec §32.7)", () => {
  it("is empty with no ratings", () => {
    expect(summarizeFeedback([])).toEqual({ count: 0, average: null, perPersona: [] });
  });

  it("averages to one decimal, overall and per persona, personas by count then name", () => {
    const items = [
      { stars: 5, personaName: "Wu" },
      { stars: 4, personaName: "Wu" },
      { stars: 4, personaName: "Wu" },
      { stars: 2, personaName: "Curie" },
      { stars: 3, personaName: "Bohr" },
    ];
    expect(summarizeFeedback(items)).toEqual({
      count: 5,
      average: 3.6,
      perPersona: [
        { personaName: "Wu", count: 3, average: 4.3 },
        { personaName: "Bohr", count: 1, average: 3 },
        { personaName: "Curie", count: 1, average: 2 },
      ],
    });
  });
});
