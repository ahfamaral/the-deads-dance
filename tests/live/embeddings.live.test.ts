import { describe, expect, it } from "vitest";
import { EMBEDDING_DIMENSIONS, embeddingModel } from "../../corpus/embeddings";

// Opt-in (`npm run test:live`): calls OpenRouter for real, costs a fraction of a cent.
try {
  process.loadEnvFile(".env");
} catch {
  throw new Error("tests/live needs a .env with OPENROUTER_API_KEY — copy .env.example to .env and fill it in.");
}

describe("OpenRouter embeddings (live)", () => {
  it("returns a 1536-dimension vector", async () => {
    const vector = await embeddingModel().embedQuery("Chien-Shiung Wu and the parity experiment");
    expect(vector).toHaveLength(EMBEDDING_DIMENSIONS);
  });
});
