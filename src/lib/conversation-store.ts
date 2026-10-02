import type { Message } from "@/lib/chat-types";

/**
 * Saved conversations, kept as JSON in the browser's localStorage.
 *
 * This deliberately does NOT save to the database. The database is reserved for
 * the personas' training data and for retrieval (RAG); conversation history is
 * a separate concern and stays out of it. The JSON shape here is also what the
 * upcoming conversation export will work from.
 *
 * localStorage is per browser: history is not shared between devices, and
 * clearing site data (or a private window) loses it.
 */

export type SavedConversation = {
  id: string;
  personaId: string;
  /** Stored alongside the id so the entry still reads if the persona is removed. */
  personaName: string;
  /** ISO timestamp of the latest save. */
  savedAt: string;
  messages: Message[];
};

const STORAGE_KEY = "persona-chatbot:conversations";

/** All saved conversations, most recently saved first. Empty if storage is unavailable. */
export function loadConversations(): SavedConversation[] {
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    const parsed: unknown = raw ? JSON.parse(raw) : [];
    if (!Array.isArray(parsed)) return [];
    return [...(parsed as SavedConversation[])].sort((a, b) =>
      b.savedAt.localeCompare(a.savedAt),
    );
  } catch {
    return [];
  }
}

/**
 * Saves a conversation, replacing any earlier save with the same id so that
 * saving again updates the entry rather than duplicating it.
 * Returns false if the browser refused the write (blocked storage, quota).
 */
export function saveConversation(conversation: SavedConversation): boolean {
  try {
    const others = loadConversations().filter((c) => c.id !== conversation.id);
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify([conversation, ...others]));
    return true;
  } catch {
    return false;
  }
}

/**
 * Removes the saved conversation with this id, if there is one.
 * Returns false if the browser refused the write (blocked storage, quota).
 */
export function deleteConversation(id: string): boolean {
  try {
    const others = loadConversations().filter((c) => c.id !== id);
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(others));
    return true;
  } catch {
    return false;
  }
}
