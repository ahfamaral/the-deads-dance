import type { LanguageMode } from "@/lib/chat-types";

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
