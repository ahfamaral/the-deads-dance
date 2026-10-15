import { OpenAIEmbeddings } from "@langchain/openai";

/**
 * Same pattern as the earlier RAG project (KI_WB/2-3-rag-langchain/src/model.ts):
 * OpenRouter is OpenAI-compatible, so LangChain's OpenAIEmbeddings reaches it by
 * base URL, with OpenRouter's namespaced model id.
 */
export const OPENROUTER_BASE_URL = "https://openrouter.ai/api/v1";

export const EMBEDDING_MODEL = "openai/text-embedding-3-small";
/** Fixed by the `vector(1536)` column in db/schema.sql. */
export const EMBEDDING_DIMENSIONS = 1536;
// Keeps worst-case retries (maxRetries 3) well under the 10-minute stale-ingest rule.
export const EMBEDDING_TIMEOUT_MS = 60_000;

/**
 * Ingest and queries embed with the same model. Ingest keeps the patient defaults; live tool
 * calls pass shorter limits to fit the 30 s tool timeout.
 */
export function embeddingModel(options: { timeout?: number; maxRetries?: number } = {}): OpenAIEmbeddings {
  const apiKey = process.env.OPENROUTER_API_KEY;
  if (!apiKey) {
    throw new Error("OPENROUTER_API_KEY is not set. Add it to .env.");
  }
  return new OpenAIEmbeddings({
    model: EMBEDDING_MODEL,
    apiKey,
    configuration: { baseURL: OPENROUTER_BASE_URL },
    maxRetries: options.maxRetries ?? 3,
    timeout: options.timeout ?? EMBEDDING_TIMEOUT_MS,
  });
}

export class EmbeddingDimensionError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "EmbeddingDimensionError";
  }
}

/** A wrong size means a model-config error; retrying won't help, so fail loudly. */
export function assertDimensions(vectors: number[][]): void {
  vectors.forEach((vector, i) => {
    if (vector.length !== EMBEDDING_DIMENSIONS) {
      throw new EmbeddingDimensionError(
        `Embedding vector ${i} has ${vector.length} dimensions; the database expects ${EMBEDDING_DIMENSIONS}. Check EMBEDDING_MODEL.`,
      );
    }
  });
}

/** Spec §26.3: $0.02 per million tokens for text-embedding-3-small, in micro-dollars per token. Embeddings are always estimated. */
export const EMBEDDING_MICROS_PER_TOKEN = 0.02;
