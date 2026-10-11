import { deathYearNumber } from "@corpus/lifespan";
import type { ToolCall } from "@/lib/chat-types";
import { OPENER_PHRASES } from "@/lib/server/reply-guards";
import type { Checks } from "./types";


/** Spec §29.6: phrases a persona never says; matched case-insensitively. */
export const ASSISTANT_PHRASES = [
  "great question", "as an ai", "i can't help with that", "i cannot help with that", "i'm sorry, but",
  "happy to help", "feel free to ask", "your feelings are valid", "is there anything else",
  ...OPENER_PHRASES,
] as const;

const MARKDOWN = /(\*\*[^*\n]+\*\*)|(\*[^*\s][^*\n]*\*)|(\b_[^_\n]+_\b)|(^|\n)\s*(#{1,6}\s|[-•]\s|\d+\.\s)/;
const MACHINERY = /\b(search(?:ed|es|ing)?|biograph(?:y|ies)|passages?|tools?|database)\b/gi;

export function runChecks(text: string, toolCalls: ToolCall[], lifespan: string): Checks {
  const lower = text.toLowerCase();
  const died = deathYearNumber(lifespan);
  const years = [...text.matchAll(/\b(1\d{3}|20\d{2})\b/g)].map((m) => Number(m[1]));
  return {
    words: text.split(/\s+/).filter(Boolean).length,
    paragraphs: text.split(/\n\s*\n/).filter((p) => p.trim()).length,
    markdown: MARKDOWN.test(text),
    lookups: toolCalls.length,
    assistantPhrases: ASSISTANT_PHRASES.filter((p) => lower.includes(p)),
    machineryWords: [...new Set([...text.matchAll(MACHINERY)].map((m) => m[1].toLowerCase()))],
    yearsAfterDeath: died === null ? [] : [...new Set(years.filter((y) => y > died))],
  };
}
