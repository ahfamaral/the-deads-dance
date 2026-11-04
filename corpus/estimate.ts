import { CHUNK_OVERLAP, CHUNK_SIZE } from "./chunking";
import { EMBEDDING_MICROS_PER_TOKEN } from "./embeddings";

/** Micro-dollars per token. */
export type Price = { prompt: number; completion: number };

const CHARS_PER_TOKEN = 4;
const MAX_ARTICLE_CHARS = 300_000;
/** Chunk overlap means some text is embedded twice: 1000 / (1000 - 200) = 1.25. */
const OVERLAP_FACTOR = CHUNK_SIZE / (CHUNK_SIZE - CHUNK_OVERLAP);

/** Spec §34.5: about what embedding this much new text costs, in micro-dollars. */
export function embeddingEstimate(chars: number): number {
  const tokens = Math.ceil(Math.ceil(chars * OVERLAP_FACTOR) / CHARS_PER_TOKEN);
  return Math.round(tokens * EMBEDDING_MICROS_PER_TOKEN);
}

/** Spec §34.5: about what one model call costs, from its input size in characters and its output tokens. */
export function modelEstimate(price: Price, inputChars: number, outputTokens: number): number {
  return Math.round(Math.ceil(inputChars / CHARS_PER_TOKEN) * price.prompt + outputTokens * price.completion);
}

/** Spec §34.5: comparing editions is one short call per edition (its text, capped, plus the instructions). */
export function comparisonEstimate(price: Price, editionChars: number[]): number {
  return editionChars.reduce((sum, chars) => sum + modelEstimate(price, Math.min(chars, MAX_ARTICLE_CHARS) + 3_000, 300), 0);
}

/** Spec §34.5: redrafting is two calls over the text, the profile and the highlights. */
export function redraftEstimate(price: Price, chars: number): number {
  return 2 * modelEstimate(price, Math.min(chars, MAX_ARTICLE_CHARS), 800);
}
