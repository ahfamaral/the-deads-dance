import { meteredEmbeddings } from "../corpus/cost-ledger";
import { getPool } from "../corpus/db";
import { EMBEDDING_MODEL, embeddingModel } from "../corpus/embeddings";
import { chatModel } from "../corpus/models";
import { judgeClaimWith } from "./biography/fact-check";
import { recallWith } from "./biography/recall";
import { CLAIM_EXPANSION_PROMPT, expandQueryWith } from "./biography/retrieval";
import type { DepsFor } from "./server";
import { cachedSparql, sparqlWith } from "./world/historical-context";

/**
 * The server's real dependencies, for stdio (index.ts) and in-process (the app, spec §31.4).
 * One pool, embeddings client and SPARQL cache per process; models per tool call. Throws when
 * OPENROUTER_API_KEY is unset.
 */
export function liveDepsFor(): DepsFor {
  const pool = getPool();
  const embeddings = embeddingModel();
  // Shared across calls: the SPARQL cache is per process (spec §4).
  const sparql = cachedSparql(sparqlWith());
  // Spec §26.3: models are built per tool call with that call's ledger. Building a ChatOpenAI is cheap.
  return (ledger) => {
    const helper = (options: Parameters<typeof chatModel>[1] = {}) => chatModel("helper", { ...options, callbacks: [ledger.handler("helper")] });
    return {
      pool,
      embeddings: meteredEmbeddings(embeddings, ledger, EMBEDDING_MODEL),
      // Spec §20.1: rewording a question needs no reasoning; splitting a claim needs a little.
      expandQuery: expandQueryWith(helper({ reasoningEffort: "minimal" })),
      expandClaim: expandQueryWith(helper({ reasoningEffort: "low" }), CLAIM_EXPANSION_PROMPT),
      judgeClaim: judgeClaimWith(helper()),
      // Spec §19.2: its own model and a short budget, so three sequential calls fit the 30 s tool timeout.
      recall: recallWith(chatModel("recall", { callbacks: [ledger.handler("recall")] })),
      sparql,
    };
  };
}
