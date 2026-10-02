import type { PrepareDeps } from "@corpus/add-persona";
import { getPool } from "@corpus/db";
import { embeddingModel } from "@corpus/embeddings";
import { profileGenerator } from "@corpus/profile";
import type { IngestDeps } from "@corpus/ingest";
import { fetchArticle, fetchPersonFacts, fetchPersonLanguages } from "@corpus/wikipedia";

/** The real dependencies for adding a persona. Route tests replace this module. */
export function corpusDeps(): IngestDeps & PrepareDeps {
  return {
    pool: getPool(),
    embeddings: embeddingModel(),
    fetchArticle: (title) => fetchArticle(title),
    fetchPersonFacts: (qid) => fetchPersonFacts(qid),
    fetchLanguages: (qid) => fetchPersonLanguages(qid),
    generateProfile: profileGenerator(),
  };
}
