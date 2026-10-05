/**
 * Spec §25.5: the chat open in this tab, so a reload (a phone switching apps) brings it back.
 * sessionStorage lasts for the tab only: another tab or device opens the conversation from
 * History, read-only. Storage can throw (private windows, blocked storage), so every access is
 * guarded.
 */
export const OPEN_CHAT_KEY = "deads-dance:open-chat";

export type OpenChat = { conversationId: string; personaId: string };

export function serializeOpenChat(c: OpenChat): string {
  return JSON.stringify({ conversationId: c.conversationId, personaId: c.personaId });
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
  const { conversationId, personaId } = v as Record<string, unknown>;
  if (typeof conversationId !== "string" || !conversationId || typeof personaId !== "string" || !personaId) return null;
  return { conversationId, personaId };
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
