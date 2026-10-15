/**
 * What the MCP biography tools return (spec §4). Shared by the MCP server, which
 * produces these, and the app, which renders them. Types only.
 */

export type Passage = { chunk_id: number; section_heading: string; content: string };

/** A typed failure: tools return this instead of throwing (spec §9). */
export type Unavailable = { status: "unavailable"; reason: string };

/** Spec §19: what the helper model recalled when the biography was silent. year is negative for BC, null when undated (§28.9). */
export type Recalled = { account: string; year: number | null };

/** recalled: the search fallback, when no passage comes close to the query. */
export type SearchBiographyResult =
  | { status: "ok"; passages: Passage[]; queries: string[]; recalled?: Recalled }
  | { status: "empty"; queries: string[]; recalled?: Recalled }
  | Unavailable;

export type Verdict = "supported" | "contradicted" | "not_mentioned" | "known_elsewhere";

export type FactCheckResult =
  | { status: "ok"; verdict: Verdict; passage?: Passage; explanation: string; recalled?: Recalled }
  | Unavailable;

export type WorldEvent = { label: string; date: string };
export type Leader = { country: string; office: string; person: string };

/** get_historical_context (spec §4): the world in one year of the persona's life, from Wikidata. */
export type HistoricalContextResult =
  | { status: "ok"; year: number; events: WorldEvent[]; leaders: Leader[] }
  | { status: "empty"; year: number; reason: string }
  | Unavailable;
