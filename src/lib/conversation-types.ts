import { languageName } from "@corpus/languages";
import type { ConversationMode, Message, Spend } from "@/lib/chat-types";
import type { Feedback } from "@/lib/feedback";
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
  /** Spec §33.5: how the conversation is held; fixed on its first turn. */
  mode: ConversationMode;
  /** Spec §33.5: the voice conversation's language code; null for text. */
  voiceLanguage: string | null;
  /** Spec §27, admin only: the owner's email. */
  userEmail?: string;
  /** Spec §26.4: a turn is still being written on the server. */
  turnRunning?: boolean;
  /** Spec §26.6, admin only. */
  spend?: Spend;
  /** Spec §32.3: the owner's rating; null when unrated. */
  feedback?: Feedback | null;
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
  /** Spec §32.6: the conversation's stars, null when unrated. */
  stars: number | null;
  /** Spec §33.6: the voice conversation's language code; null for text. */
  voiceLanguage: string | null;
  /** Spec §27, admin only: whose conversation it is. */
  userEmail?: string;
  /** Spec §27, admin only: the admin's own. */
  mine?: boolean;
};

/** Spec §33.6: the line that marks a voice conversation in a record, an export and the PDF. */
export const voiceMarker = (voiceLanguage: string) => `Voice conversation · ${languageName(voiceLanguage)}`;

export const PREVIEW_CHARS = 120;

export function cutPreview(text: string | null): string | null {
  if (text === null) return null;
  const line = text.replace(/\s+/g, " ").trim();
  return line.length > PREVIEW_CHARS ? `${line.slice(0, PREVIEW_CHARS).trimEnd()}…` : line;
}

/** Spec §27: whose conversation a History row is, for the admin; null in a tester's own list. */
export function ownerLine(s: ConversationSummary): string | null {
  if (s.mine === true) return "you";
  return s.userEmail ?? null;
}

/** Spec §27: the admin can't delete another user's conversation. */
export const canDelete = (s: ConversationSummary) => s.mine !== false;
