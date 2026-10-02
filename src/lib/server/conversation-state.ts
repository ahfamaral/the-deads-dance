import { languageName, type PersonaLanguage } from "@corpus/languages";
import type { LanguageMode } from "@/lib/chat-types";
import type { Visit } from "@/lib/visit";

/** Acts come back from the browser, so anything visitor-derived is re-sanitised here (spec §10). */
function asData(text: string): string {
  return text.replace(/[<>]/g, "").replace(/\s+/g, " ").trim();
}

function patienceLine(visit: Visit): string | null {
  if (visit.leavingNow) return "End the conversation now, in one or two lines, as you would. Do not insult them back.";
  if (visit.patience >= 2) return "You are enjoying this visitor.";
  if (visit.rudeSoFar && visit.patience <= -3) return "You are close to showing them out.";
  if (visit.rudeSoFar && visit.patience <= -1) return "Your patience is thinning: they have been rude to you.";
  return null;
}

function languageLine(code: string | null, languages: PersonaLanguage[], mode: LanguageMode): string | null {
  if (!code || code === "und") return null;
  const name = languageName(code);
  const spoken = languages.find((l) => l.code === code);
  if (spoken) return `The visitor writes in ${name}. You speak it${spoken.native ? ", your native language" : ""}; answer in ${name}.`;
  if (mode === "visitor") return `The visitor writes in ${name}. Answer in ${name}, even though you never spoke it.`;
  const fallback = languages.find((l) => l.code === "en") ?? languages[0];
  const fallbackName = fallback ? languageName(fallback.code) : "English";
  return `The visitor writes in ${name}, which you never learned: you cannot understand what they wrote. Say so in your own way, in ${fallbackName}, and do not answer its content.`;
}

/** Spec §18.3: only the lines that apply, in plain words; null when there is nothing to say. */
export function renderConversationState(opts: {
  visit: Visit | null;
  languages: PersonaLanguage[];
  languageMode: LanguageMode;
}): string | null {
  const { visit } = opts;
  if (!visit) return null;
  const name = visit.visitorName ? asData(visit.visitorName) : "";
  const lines = [
    name ? `The visitor's name is ${name}.` : null,
    visit.wants === "brief" ? "The visitor's last message wants a brief answer: a line or two." : null,
    visit.wants === "long" ? "The visitor wants the longer story: a few paragraphs at most, then stop at a natural point." : null,
    patienceLine(visit),
    visit.sorePoint ? "This touches on something painful to you." : null,
    visit.farewell ? "The visitor is leaving. Say goodbye as you would." : null,
    visit.afterFarewell ? "The visitor said goodbye but has stayed on." : null,
    visit.tired && !visit.windDown ? "You are getting tired; the visit has been long." : null,
    visit.windDown ? "Bring the visit to a close now, in your own way." : null,
    languageLine(visit.language, opts.languages, opts.languageMode),
  ].filter((l): l is string => l !== null);
  return lines.length ? `<conversation_state>\n${lines.join("\n")}\n</conversation_state>` : null;
}
