import type { EmbeddingsInterface } from "@langchain/core/embeddings";

/** Deterministic vector per text: same text, same vector. No network. */
export function vectorFor(text: string, dimensions = 1536): number[] {
  let seed = 0;
  for (const ch of text) seed = (seed * 31 + ch.charCodeAt(0)) >>> 0;
  return Array.from({ length: dimensions }, (_, i) => Math.sin(seed + i));
}

export class FakeEmbeddings implements EmbeddingsInterface {
  calls = 0;

  constructor(private readonly options: { dimensions?: number; fail?: Error } = {}) {}

  async embedDocuments(texts: string[]): Promise<number[][]> {
    this.calls++;
    if (this.options.fail) throw this.options.fail;
    return texts.map((t) => vectorFor(t, this.options.dimensions));
  }

  async embedQuery(text: string): Promise<number[]> {
    return (await this.embedDocuments([text]))[0];
  }
}

/** Maps chosen texts to chosen vectors, so a test decides which chunk each query lands on. */
export class TableEmbeddings implements EmbeddingsInterface {
  texts: string[] = [];

  constructor(private readonly table: Record<string, number[]>) {}

  async embedDocuments(texts: string[]): Promise<number[][]> {
    this.texts.push(...texts);
    return texts.map((t) => this.table[t] ?? vectorFor(t));
  }

  async embedQuery(text: string): Promise<number[]> {
    return (await this.embedDocuments([text]))[0];
  }
}

/** Unit vector along one axis. */
export function axis(i: number, dimensions = 1536): number[] {
  return Array.from({ length: dimensions }, (_, j) => (j === i ? 1 : 0));
}

const CONSENSUS_SIZE = 24;

/**
 * Twenty-four "consensus" chunks (one axis each) that CONSENSUS_QUERY ranks in ordinal order,
 * plus a "detail" chunk (content DETAIL_CONTENT) that it ranks last — beyond the candidate
 * depth for top_k 5 — and that only DETAIL_QUERY finds.
 */
export const CONSENSUS_CHUNKS = Array.from({ length: CONSENSUS_SIZE + 1 }, (_, i) => axis(i));
export const CONSENSUS_QUERY = Array.from({ length: 1536 }, (_, j) => (j < CONSENSUS_SIZE ? CONSENSUS_SIZE - j : 0));
export const DETAIL_QUERY = axis(CONSENSUS_SIZE);
export const DETAIL_CONTENT = `chunk ${CONSENSUS_SIZE}`;
