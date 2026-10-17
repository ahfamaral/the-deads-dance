import type { LanguageMode, Message } from "@/lib/chat-types";

const KEY = "persona-chatbot:language-mode";

/** Spec §18.4: the "Always answer in my language" switch, remembered per browser. */
export function loadLanguageMode(): LanguageMode {
  try {
    return window.localStorage.getItem(KEY) === "visitor" ? "visitor" : "realistic";
  } catch {
    return "realistic";
  }
}

export function saveLanguageMode(mode: LanguageMode): void {
  try {
    window.localStorage.setItem(KEY, mode);
  } catch {
    // Blocked storage: the switch still works for this page, it just isn't remembered.
  }
}

/**
 * 2026-10-17: where the conversation shows "Always answer in my language: on/off": before the first
 * visitor message sent after the switch changed (it starts off). Messages that don't record it (older
 * ones, voice) are skipped. Keyed by message id.
 */
export function languageModeNotes(messages: Message[]): Map<string, "on" | "off"> {
  const notes = new Map<string, "on" | "off">();
  let current: LanguageMode = "realistic";
  for (const m of messages) {
    if (m.role !== "user" || !m.languageMode || m.languageMode === current) continue;
    current = m.languageMode;
    notes.set(m.id, current === "visitor" ? "on" : "off");
  }
  return notes;
}
