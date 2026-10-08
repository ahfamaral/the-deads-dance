import type { ToolCall } from "@/lib/chat-types";

/** Spec §29.6: recall@3 and reciprocal rank of the labelled section, from the turn's first search. */
export function scoreRetrieval(toolCalls: ToolCall[], section: string | undefined): { recallAt3: boolean; reciprocalRank: number } | null {
  if (!section) return null;
  const first = toolCalls.find((c) => c.toolName === "search_biography" && c.status === "ok");
  const passages = (first?.result as { passages?: { section_heading?: string }[] } | undefined)?.passages;
  if (!passages) return null;
  const rank = passages.findIndex((p) => p.section_heading === section) + 1;
  return { recallAt3: rank >= 1 && rank <= 3, reciprocalRank: rank ? 1 / rank : 0 };
}
