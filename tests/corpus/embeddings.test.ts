import { afterEach, describe, expect, it } from "vitest";
import {
  assertDimensions,
  EMBEDDING_DIMENSIONS,
  EMBEDDING_MODEL,
  EMBEDDING_TIMEOUT_MS,
  EmbeddingDimensionError,
  embeddingModel,
} from "../../corpus/embeddings";

const savedKey = process.env.OPENROUTER_API_KEY;
afterEach(() => {
  process.env.OPENROUTER_API_KEY = savedKey;
});

describe("embeddingModel", () => {
  it("throws a clear error without an API key", () => {
    delete process.env.OPENROUTER_API_KEY;
    expect(() => embeddingModel()).toThrow(/OPENROUTER_API_KEY/);
  });

  it("targets the OpenRouter model id", () => {
    process.env.OPENROUTER_API_KEY = "test-key";
    expect(embeddingModel().model).toBe(EMBEDDING_MODEL);
  });

  it("sets a request timeout", () => {
    process.env.OPENROUTER_API_KEY = "test-key";
    expect(embeddingModel().timeout).toBe(EMBEDDING_TIMEOUT_MS);
  });
});

describe("assertDimensions", () => {
  it("accepts 1536-dimension vectors", () => {
    expect(() => assertDimensions([new Array(EMBEDDING_DIMENSIONS).fill(0)])).not.toThrow();
  });

  it("rejects any other size and names the index", () => {
    const vectors = [new Array(1536).fill(0), new Array(3).fill(0)];
    expect(() => assertDimensions(vectors)).toThrow(EmbeddingDimensionError);
    expect(() => assertDimensions(vectors)).toThrow(/vector 1 has 3 dimensions/);
  });
});
