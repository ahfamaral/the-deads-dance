import type { SearchBiographyResult } from "../../corpus/tool-results";
import { retrieve, type RetrievalDeps } from "./retrieval";

export const DEFAULT_TOP_K = 3;

export function searchBiography(
  deps: RetrievalDeps,
  input: { query: string; persona_id: string; top_k?: number },
): Promise<SearchBiographyResult> {
  return retrieve(deps, { query: input.query, personaSlug: input.persona_id, topK: input.top_k ?? DEFAULT_TOP_K });
}
