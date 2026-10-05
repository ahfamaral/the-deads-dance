import type { Message } from "@/lib/chat-types";
import type { VisitEnding } from "@/lib/visit";

/**
 * Spec §25.4: conversations as the API returns them. Browser-safe. History, export and the
 * PDF all work from StoredConversation.
 */
export type StoredConversation = {
  id: string;
  /** The persona's slug. */
  personaId: string;
  /** Copied when the conversation started, so it still reads if the persona is removed. */
  personaName: string;
  /** ISO timestamp of the latest message. */
  updatedAt: string;
  messages: Message[];
};

/** One History row: no message bodies. */
export type ConversationSummary = {
  id: string;
  personaId: string;
  personaName: string;
  /** The first visitor message, on one line, cut to PREVIEW_CHARS. */
  preview: string | null;
  updatedAt: string;
  ended: VisitEnding | null;
};

export const PREVIEW_CHARS = 120;

export function cutPreview(text: string | null): string | null {
  if (text === null) return null;
  const line = text.replace(/\s+/g, " ").trim();
  return line.length > PREVIEW_CHARS ? `${line.slice(0, PREVIEW_CHARS).trimEnd()}…` : line;
}
