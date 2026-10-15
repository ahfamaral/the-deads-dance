import { meteredEmbeddings } from "../corpus/cost-ledger";
import { getPool } from "../corpus/db";
import { EMBEDDING_MODEL, embeddingModel } from "../corpus/embeddings";
import { chatModel } from "../corpus/models";
import { judgeClaimWith } from "./biography/fact-check";
import { recallTopicWith, recallWith } from "./biography/recall";
import { CLAIM_EXPANSION_PROMPT, expandQueryWith } from "./biography/retrieval";
import type { DepsFor } from "./server";
import { cachedSparql, sparqlWith } from "./world/historical-context";

/**
 * Per-try timeout and retries for each sequential step of a tool call. Their worst cases must fit
 * the app's 30 s tool timeout (tests/mcp/deps.test.ts), or the call fails with no result: search_biography
 * runs expansion, embedding, then maybe recall (RECALL_MAX_MS); fact_check_claim runs expansion, embedding
 * and the judge, with recall alongside (spec §28.9).
 * A failed expansion searches the original query, a failed judge is not_mentioned, so neither retries.
 */
export const STEP_LIMITS = {
  expansion: { timeout: 8_000, maxRetries: 0 },
  embedding: { timeout: 4_000, maxRetries: 1 },
  judge: { timeout: 10_000, maxRetries: 0 },
} as const;

/**
 * The server's real dependencies, for stdio (index.ts) and in-process (the app, spec §31.4).
 * One pool, embeddings client and SPARQL cache per process; models per tool call. Throws when
 * OPENROUTER_API_KEY is unset.
 */
export function liveDepsFor(): DepsFor {
  const pool = getPool();
  const embeddings = embeddingModel(STEP_LIMITS.embedding);
  // Shared across calls: the SPARQL cache is per process (spec §4).
  const sparql = cachedSparql(sparqlWith());
  // Spec §26.3: models are built per tool call with that call's ledger. Building a ChatOpenAI is cheap.
  return (ledger) => {
    const helper = (options: Parameters<typeof chatModel>[1] = {}) => chatModel("helper", { ...options, callbacks: [ledger.handler("helper")] });
    return {
      pool,
      embeddings: meteredEmbeddings(embeddings, ledger, EMBEDDING_MODEL),
      // Spec §20.1, revised 2026-10-15: no reasoning for either. On DeepSeek v4.1 flash, "minimal" and "low"
      // still reasoned for 16–19 s, so every expansion timed out; "none" splits a claim as well in about 2 s.
      expandQuery: expandQueryWith(helper({ ...STEP_LIMITS.expansion, reasoningEffort: "none" })),
      expandClaim: expandQueryWith(helper({ ...STEP_LIMITS.expansion, reasoningEffort: "none" }), CLAIM_EXPANSION_PROMPT),
      judgeClaim: judgeClaimWith(helper(STEP_LIMITS.judge)),
      // Spec §19.2: its own model and a 10 s budget, run alongside the biography check.
      recall: recallWith(chatModel("recall", { callbacks: [ledger.handler("recall")] })),
      // search_biography's fallback when no passage comes close; after the search, so it fits the 30 s too.
      recallTopic: recallTopicWith(chatModel("recall", { callbacks: [ledger.handler("recall")] })),
      sparql,
    };
  };
}
