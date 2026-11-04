import { z } from "zod";
import type { Message } from "@/lib/chat-types";
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
    if (c === null) {
      sessionStorage.removeItem(OPEN_CHAT_KEY);
      sessionStorage.removeItem(HEARD_REPLY_KEY);
    } else sessionStorage.setItem(OPEN_CHAT_KEY, serializeOpenChat(c));
  } catch {
    // Not remembered; the chat still works, it just won't survive a reload.
  }
}

/**
 * Spec §33.5: the last persona reply this tab finished playing in the open voice chat, as its
 * position (the conversation's length with it): the server stores the reply under its own id, so
 * the id seen while streaming never comes back. A restored chat whose last reply isn't it shows
 * that reply's text, as for a lost voice.
 */
export const HEARD_REPLY_KEY = "deads-dance:heard-reply";

export function readHeardReply(conversationId: string): number | null {
  try {
    const v: unknown = JSON.parse(sessionStorage.getItem(HEARD_REPLY_KEY) ?? "null");
    if (typeof v !== "object" || v === null) return null;
    const { conversationId: id, length } = v as Record<string, unknown>;
    return id === conversationId && Number.isInteger(length) ? (length as number) : null;
  } catch {
    return null;
  }
}

export function writeHeardReply(conversationId: string, length: number): void {
  try {
    sessionStorage.setItem(HEARD_REPLY_KEY, JSON.stringify({ conversationId, length }));
  } catch {
    // Not remembered: after a reload the last reply shows as text, which is harmless.
  }
}

/** The last message, when it is a persona reply other than the one heard. */
export function unheardReply(messages: Message[], heardLength: number | null): Message | null {
  const last = messages.at(-1);
  return last?.role === "persona" && messages.length !== heardLength ? last : null;
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

/** Spec §34.7: `/?manage=1` (Back from a persona's profile) opens the persona picker in configure mode. */
export function linkedManage(search: string): boolean {
  return new URLSearchParams(search).get("manage") === "1";
}
