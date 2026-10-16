import { z } from "zod";
import type { StoredConversation } from "@/lib/conversation-types";

/**
 * Spec §25.5: the chat open in this tab, so a reload (a phone switching apps) brings it back.
 * sessionStorage lasts for the tab only: another tab or device opens the conversation from
 * History, read-only. Storage can throw (private windows, blocked storage), so every access is
 * guarded.
 */
export const OPEN_CHAT_KEY = "deads-dance:open-chat";

/** voiceLanguage: spec §33.5, set for a voice conversation, so a reload before its first turn still knows the language. */
export type OpenChat = { conversationId: string; personaId: string; voiceLanguage?: string };

export function serializeOpenChat(c: OpenChat): string {
  return JSON.stringify({ conversationId: c.conversationId, personaId: c.personaId, ...(c.voiceLanguage ? { voiceLanguage: c.voiceLanguage } : {}) });
}

export function parseOpenChat(raw: string | null): OpenChat | null {
  if (!raw) return null;
  let v: unknown;
  try {
    v = JSON.parse(raw);
  } catch {
    return null;
  }
  if (typeof v !== "object" || v === null || Array.isArray(v)) return null;
  const { conversationId, personaId, voiceLanguage } = v as Record<string, unknown>;
  if (typeof conversationId !== "string" || !conversationId || typeof personaId !== "string" || !personaId) return null;
  const language = typeof voiceLanguage === "string" && /^[a-z]{2,3}$/.test(voiceLanguage) ? voiceLanguage : undefined;
  return { conversationId, personaId, ...(language ? { voiceLanguage: language } : {}) };
}

export function readOpenChat(): OpenChat | null {
  try {
    return parseOpenChat(sessionStorage.getItem(OPEN_CHAT_KEY));
  } catch {
    return null;
  }
}

/** null forgets it: the chat was left, so it opens read-only from History from now on. */
export function writeOpenChat(c: OpenChat | null): void {
  try {
    if (c === null) sessionStorage.removeItem(OPEN_CHAT_KEY);
    else sessionStorage.setItem(OPEN_CHAT_KEY, serializeOpenChat(c));
  } catch {
    // Not remembered; the chat still works, it just won't survive a reload.
  }
}

/**
 * Spec §27: the admin's reads carry the owner's email, so a tab that switched accounts could get
 * someone else's conversation back. Only your own reopens live; anyone else's opens from History.
 */
export function canRestoreLive(conversation: StoredConversation, email: string): boolean {
  return !conversation.userEmail || conversation.userEmail === email;
}

/** Spec §32.7: the admin's Feedback list links to `/?open=<id>`, which opens that conversation read-only. */
export function linkedConversation(search: string): string | null {
  const id = new URLSearchParams(search).get("open");
  return id && z.uuid().safeParse(id).success ? id : null;
}
