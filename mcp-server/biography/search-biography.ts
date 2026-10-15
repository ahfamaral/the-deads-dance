import { findPersona } from "../../corpus/personas";
import type { SearchBiographyResult } from "../../corpus/tool-results";
import { RECALL_MAX_MS } from "./fact-check";
import { acceptRecall, type Recall } from "./recall";
import { retrieveScored, type RetrievalDeps } from "./retrieval";

export const DEFAULT_TOP_K = 3;

/**
 * Below this cosine similarity between the query and its closest passage, the biography likely
 * doesn't hold the topic, so search_biography asks recall too. Calibrated on text-embedding-3-small
 * (2026-10-15, 20 answerable and 13 unanswerable queries): the scores overlap. Names score high
 * against family passages (the MMDC students 0.43 for Vargas), and some real hits score low (his
 * suicide 0.39). 0.45 catches every miss; on a weak hit, recall's faint memory sits beside the passage.
 */
export const RECALL_FALLBACK_SCORE = 0.45;

export type SearchDeps = RetrievalDeps & {
  /** The search fallback. Real version: recallTopicWith(chatModel("recall")). */
  recallTopic: Recall;
};

/**
 * The biography's passages, plus what recall knows when none comes close to the query. Recall
 * no longer waits for the persona model to fact-check what it can't find. `signal` is the MCP
 * call's cancellation.
 */
export async function searchBiography(
  deps: SearchDeps,
  input: { query: string; persona_id: string; top_k?: number },
  signal?: AbortSignal,
): Promise<SearchBiographyResult> {
  const { result, topScore } = await retrieveScored(deps, {
    query: input.query,
    personaSlug: input.persona_id,
    topK: input.top_k ?? DEFAULT_TOP_K,
  });
  if (result.status === "unavailable" || (topScore !== null && topScore >= RECALL_FALLBACK_SCORE)) return result;
  const recalled = await recallTopic(deps, input, signal);
  return recalled ? { ...result, recalled } : result;
}

/** Recall can only add a faint memory; any failure keeps the plain result. */
async function recallTopic(deps: SearchDeps, input: { query: string; persona_id: string }, signal?: AbortSignal) {
  if (signal?.aborted) return null;
  try {
    const persona = await findPersona(deps.pool, input.persona_id);
    if (!persona) return null;
    const { displayName, description, lifespan } = persona;
    const raw = await deps.recallTopic(input.query, { displayName, description, lifespan }, { timeoutMs: RECALL_MAX_MS, signal });
    return acceptRecall(raw, lifespan);
  } catch (err) {
    if (!signal?.aborted) console.error("Search fallback recall failed; keeping the biography's result.", err);
    return null;
  }
}
