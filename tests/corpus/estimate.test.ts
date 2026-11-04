import { describe, expect, it } from "vitest";
import { EMBEDDING_MICROS_PER_TOKEN } from "@corpus/embeddings";
import { comparisonEstimate, embeddingEstimate, modelEstimate, redraftEstimate } from "@corpus/estimate";

const price = { prompt: 0.1, completion: 0.4 };

describe("embeddingEstimate", () => {
  it("is 0 for no text", () => {
    expect(embeddingEstimate(0)).toBe(0);
  });
  it("counts 4 chars a token with chunk overlap (x1.25)", () => {
    expect(embeddingEstimate(4000)).toBe(Math.round(1250 * EMBEDDING_MICROS_PER_TOKEN));
  });
});

describe("modelEstimate", () => {
  it("is input tokens x prompt + output tokens x completion", () => {
    expect(modelEstimate(price, 4000, 100)).toBe(140);
  });
});

describe("comparisonEstimate", () => {
  it("adds 3,000 chars and 300 output tokens per edition", () => {
    expect(comparisonEstimate(price, [1000, 2000])).toBe(modelEstimate(price, 4000, 300) + modelEstimate(price, 5000, 300));
  });
  it("caps each edition at 300,000 chars", () => {
    expect(comparisonEstimate(price, [900_000])).toBe(modelEstimate(price, 303_000, 300));
  });
});

describe("redraftEstimate", () => {
  it("is two calls (profile and highlights), capped at 300,000 chars", () => {
    expect(redraftEstimate(price, 1_000_000)).toBe(2 * modelEstimate(price, 300_000, 800));
  });
});
