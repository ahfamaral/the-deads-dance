import type { PrepareDeps } from "@corpus/add-persona";
import { CostLedger, meteredEmbeddings } from "@corpus/cost-ledger";
import { getPool } from "@corpus/db";
import { EMBEDDING_MODEL, embeddingModel } from "@corpus/embeddings";
import { profileGenerator } from "@corpus/profile";
import type { IngestDeps } from "@corpus/ingest";
import { fetchArticle, fetchPersonFacts, fetchPersonLanguages } from "@corpus/wikipedia";

/** The real dependencies for adding a persona. Spec §26.3: its model calls land on the given ledger. Route tests replace this module. */
export function corpusDeps(ledger: CostLedger = new CostLedger()): IngestDeps & PrepareDeps {
  return {
    pool: getPool(),
    embeddings: meteredEmbeddings(embeddingModel(), ledger, EMBEDDING_MODEL),
    fetchArticle: (title) => fetchArticle(title),
    fetchPersonFacts: (qid) => fetchPersonFacts(qid),
    fetchLanguages: (qid) => fetchPersonLanguages(qid),
    generateProfile: profileGenerator({ callbacks: [ledger.handler("ingest")] }),
  };
}
