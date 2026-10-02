import type { Message, ToolCall } from "@/lib/chat-types";
import type { Leader, Passage, Recalled, Verdict, WorldEvent } from "@corpus/tool-results";

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function isPassage(value: unknown): value is Passage {
  return (
    isRecord(value) &&
    typeof value.chunk_id === "number" &&
    typeof value.section_heading === "string" &&
    typeof value.content === "string"
  );
}

/** Passages in a tool result: search_biography's list, or fact_check_claim's judged passage. */
export function passagesIn(result: unknown): Passage[] {
  if (!isRecord(result) || result.status !== "ok") return [];
  if (Array.isArray(result.passages)) return result.passages.filter(isPassage);
  return isPassage(result.passage) ? [result.passage] : [];
}

const LABELS: Record<string, string> = {
  search_biography: "Searched biography",
  fact_check_claim: "Fact-checked claim",
  get_historical_context: "Looked up the times",
};

export function toolLabel(toolName: string): string {
  return LABELS[toolName] ?? toolName;
}

/** The query, claim or year the persona passed, for the collapsed row. */
export function toolSubject(call: ToolCall): string | null {
  const value = call.arguments.query ?? call.arguments.claim ?? call.arguments.year;
  if (typeof value === "number") return String(value);
  return typeof value === "string" ? value : null;
}

/** The events and leaders of a get_historical_context result, or null for any other result. */
export function historicalContextOf(call: ToolCall): { year: number; events: WorldEvent[]; leaders: Leader[] } | null {
  const r = call.result;
  if (call.status !== "ok" || call.toolName !== "get_historical_context" || !isRecord(r) || r.status !== "ok") return null;
  if (typeof r.year !== "number") return null;
  const events = (Array.isArray(r.events) ? r.events : []).filter(
    (e): e is WorldEvent => isRecord(e) && typeof e.label === "string" && typeof e.date === "string",
  );
  const leaders = (Array.isArray(r.leaders) ? r.leaders : []).filter(
    (l): l is Leader => isRecord(l) && typeof l.country === "string" && typeof l.office === "string" && typeof l.person === "string",
  );
  return { year: r.year, events, leaders };
}

const VERDICTS: readonly Verdict[] = ["supported", "contradicted", "not_mentioned", "known_elsewhere"];

export const VERDICT_LABELS: Record<Verdict, string> = {
  supported: "supported",
  contradicted: "contradicted",
  not_mentioned: "not mentioned",
  known_elsewhere: "general knowledge",
};

/** Spec §19.5: shown under every recall answer, so grounding stays visible. */
export const GENERAL_KNOWLEDGE_NOTE = "Not in the biography; from the model's general knowledge.";

export function verdictOf(call: ToolCall): Verdict | null {
  const r = call.result;
  if (call.status !== "ok" || !isRecord(r) || r.status !== "ok") return null;
  return VERDICTS.find((v) => v === r.verdict) ?? null;
}

/** What a known_elsewhere fact check recalled, or null. Any other verdict never shows an account. */
export function recalledOf(call: ToolCall): Recalled | null {
  const r = call.result;
  if (verdictOf(call) !== "known_elsewhere" || !isRecord(r) || !isRecord(r.recalled)) return null;
  const { account, year } = r.recalled;
  return typeof account === "string" && typeof year === "number" ? { account, year } : null;
}

export function explanationOf(call: ToolCall): string | null {
  const r = call.result;
  return isRecord(r) && typeof r.explanation === "string" && r.explanation ? r.explanation : null;
}

/** The query variants a search actually ran: query translation, made visible. */
export function queriesOf(call: ToolCall): string[] {
  const r = call.result;
  return isRecord(r) && Array.isArray(r.queries) ? r.queries.filter((q): q is string => typeof q === "string") : [];
}

/** Why a finished call produced nothing usable, or null when it did (or is still running). */
export function problemOf(call: ToolCall): string | null {
  const r = call.result;
  if (call.status === "running") return null;
  if (call.status === "error") return isRecord(r) && typeof r.error === "string" ? r.error : "The tool failed.";
  if (isRecord(r) && r.status === "unavailable") return typeof r.reason === "string" ? r.reason : "Unavailable.";
  if (isRecord(r) && r.status === "empty") return typeof r.reason === "string" ? r.reason : "Nothing found in the biography.";
  return null;
}

/**
 * Spec §19.5: a reply that drew on recall may still carry biography chips from its searches,
 * which would suggest those passages back the recalled part too.
 */
export function usesGeneralKnowledge(message: Message): boolean {
  return (message.toolCalls ?? []).some((call) => recalledOf(call) !== null);
}

export const MIXED_SOURCES_NOTE = "Part of this answer is from general knowledge, not these passages.";

/** chunkId → passage, from all of a message's tool results. Source chips show these; no extra fetch. */
export function passagesById(message: Message): Map<number, Passage> {
  const passages = new Map<number, Passage>();
  for (const call of message.toolCalls ?? []) {
    if (call.status !== "ok") continue;
    for (const p of passagesIn(call.result)) passages.set(p.chunk_id, p);
  }
  return passages;
}
