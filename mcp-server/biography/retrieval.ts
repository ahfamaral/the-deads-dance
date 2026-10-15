import type { EmbeddingsInterface } from "@langchain/core/embeddings";
import type { BaseChatModel } from "@langchain/core/language_models/chat_models";
import type { Pool } from "pg";
import { z } from "zod";
import { findPersona } from "../../corpus/personas";
import { searchChunks, type SearchHit } from "../../corpus/search";
import type { SearchBiographyResult } from "../../corpus/tool-results";

/** Standard RRF constant: damps the difference between rank 1 and rank 2 of a single list. */
export const RRF_K = 60;
export const MAX_VARIANTS = 3;
/**
 * The original query's list counts this many times in RRF: it is what was asked, while the
 * variants are the helper model's guesses and are sometimes speculative.
 */
export const ORIGINAL_QUERY_WEIGHT = 2;
/**
 * Candidates searched per query. RRF gives a chunk nothing for a list it's missing from, so at
 * a shallow depth a relevant chunk one variant ranks just below the cut loses that whole vote.
 */
export const MIN_CANDIDATE_DEPTH = 20;

export function candidateDepth(topK: number): number {
  return Math.max(MIN_CANDIDATE_DEPTH, 3 * topK);
}

export type RetrievalDeps = {
  pool: Pool;
  embeddings: EmbeddingsInterface;
  /** Rewrites of the query. Real version: expandQueryWith(helper model); tests pass plain functions. */
  expandQuery: (query: string) => Promise<string[]>;
};

/**
 * Reciprocal Rank Fusion: every list adds weight / (k + rank) to each chunk it contains, rank
 * counted from 1; the first list (the original query) has originalWeight, the rest 1. Chunks
 * found by several queries rise. Ties keep first-seen order.
 */
export function fuseRankings(lists: SearchHit[][], k = RRF_K, originalWeight = ORIGINAL_QUERY_WEIGHT): SearchHit[] {
  const fused = new Map<number, { hit: SearchHit; score: number; firstSeen: number }>();
  let seen = 0;
  lists.forEach((list, listIndex) => {
    const weight = listIndex === 0 ? originalWeight : 1;
    list.forEach((hit, i) => {
      const entry = fused.get(hit.chunkId) ?? { hit, score: 0, firstSeen: seen++ };
      entry.score += weight / (k + i + 1);
      fused.set(hit.chunkId, entry);
    });
  });
  return [...fused.values()]
    .sort((a, b) => b.score - a.score || a.firstSeen - b.firstSeen)
    .map(({ hit, score }) => ({ ...hit, score }));
}

/**
 * Each query's top hit first, in query order (skipping one already taken), then the fused
 * order fills the rest. For a claim split into one query per detail: fusion rewards passages
 * that match every query, so a passage holding a single detail would otherwise never reach
 * the judge.
 */
export function coverEachQuery(lists: SearchHit[][], topK: number): SearchHit[] {
  const chosen = new Map<number, SearchHit>();
  for (const top of lists.map((list) => list[0])) {
    if (chosen.size >= topK) break;
    if (top && !chosen.has(top.chunkId)) chosen.set(top.chunkId, top);
  }
  for (const hit of fuseRankings(lists)) {
    if (chosen.size >= topK) break;
    if (!chosen.has(hit.chunkId)) chosen.set(hit.chunkId, hit);
  }
  return [...chosen.values()];
}

/** The original query plus up to MAX_VARIANTS distinct rewrites. A failed expansion searches the original alone. */
async function queriesFor(query: string, expandQuery: RetrievalDeps["expandQuery"]): Promise<string[]> {
  let variants: string[] = [];
  try {
    variants = await expandQuery(query);
  } catch (err) {
    console.error("Query expansion failed; searching the original query only.", err);
  }
  const unique = new Set([query]);
  for (const variant of variants) {
    if (unique.size > MAX_VARIANTS) break;
    const trimmed = variant.trim();
    if (trimmed) unique.add(trimmed);
  }
  return [...unique];
}

/**
 * Spec §6 retrieval path, shared by search_biography and fact_check_claim: expand the
 * query, embed all variants in one call, search each against the persona, fuse with RRF.
 */
export async function retrieve(
  deps: RetrievalDeps,
  params: { query: string; personaSlug: string; topK: number; coverEachQuery?: boolean },
): Promise<SearchBiographyResult> {
  return (await retrieveScored(deps, params)).result;
}

/**
 * retrieve, plus the original query's best cosine similarity: how close the biography comes to
 * what was asked. Variants are left out, as the helper's guesses can match what wasn't asked.
 * null when nothing was searched or found.
 */
export async function retrieveScored(
  deps: RetrievalDeps,
  params: { query: string; personaSlug: string; topK: number; coverEachQuery?: boolean },
): Promise<{ result: SearchBiographyResult; topScore: number | null }> {
  const persona = await findPersona(deps.pool, params.personaSlug);
  if (!persona || persona.status !== "ready") {
    return { result: { status: "unavailable", reason: `No ready persona "${params.personaSlug}".` }, topScore: null };
  }

  const queries = await queriesFor(params.query, deps.expandQuery);
  const vectors = await deps.embeddings.embedDocuments(queries);
  const depth = candidateDepth(params.topK);
  const lists = await Promise.all(
    vectors.map((embedding) => searchChunks(deps.pool, { personaSlug: params.personaSlug, embedding, topK: depth })),
  );
  const topScore = lists[0][0]?.score ?? null;

  const top = params.coverEachQuery ? coverEachQuery(lists, params.topK) : fuseRankings(lists).slice(0, params.topK);
  if (top.length === 0) return { result: { status: "empty", queries }, topScore };
  return {
    result: {
      status: "ok",
      queries,
      passages: top.map((h) => ({ chunk_id: h.chunkId, section_heading: h.sectionHeading, content: h.content })),
    },
    topScore,
  };
}

const VariantsSchema = z.object({
  variants: z.array(z.string()).describe("Three alternative search queries"),
});

// Every passage is about the persona, so their name (or "biography", "life") in a variant
// matches all of them and pulls in overview passages instead of the topic.
export const EXPANSION_PROMPT = `You turn a question or claim about a person into three alternative search queries over passages of that person's Wikipedia biography.
Every passage is already about this person, so leave out their name and generic words such as "biography", "life" or "career": they match every passage and drown out the topic.
Each query uses different wording from the input, or names the likely topic directly (a place, period, organisation, event or work). When the input combines several specific details, give each detail its own query.
Return only the queries.`;

/** For fact_check_claim: one query per detail, so each detail's evidence is searched for on its own. */
export const CLAIM_EXPANSION_PROMPT = `You split a claim about a person into short search queries over passages of that person's Wikipedia biography, so that each detail of the claim can be checked.
Write up to three queries, one per checkable detail the claim asserts (such as what happened, where, when, with whom, or the result), each in words a biography would use.
Every passage is already about this person, so leave out their name and generic words such as "biography", "life" or "career".
Return only the queries.`;

export function expandQueryWith(model: BaseChatModel, prompt = EXPANSION_PROMPT): RetrievalDeps["expandQuery"] {
  const structured = model.withStructuredOutput(VariantsSchema, { name: "query_variants" });
  return async (query) =>
    (
      await structured.invoke([
        { role: "system", content: prompt },
        { role: "user", content: query },
      ])
    ).variants;
}
