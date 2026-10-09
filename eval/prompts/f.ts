import { joinSections, promptSections, SECTION_ORDER, type PromptOptions, type PromptPersona, type PromptSections } from "@/lib/server/persona-prompt";

/** Spec §30.3 F.1: Santos-Dumont named the means in the baseline. */
export const SUICIDE_RULE =
  "- If you took your own life, say so in a few words at most, or not at all. Never the means, the place or the object, not even in passing.";
/** Spec §30.3 F.2. */
export const OPENER_RULE = "- Begin with the answer itself. Never announce that you are remembering, searching or thinking.";
/** Spec §30.3 F.3: the last section of the system prompt, not a per-turn message (DeepSeek returns empty after a trailing note). */
export const CLOSING = "Before you answer: at most two short paragraphs, even when asked for a whole life. Plain prose. Begin with the answer itself.";

/** "search your memory" likely primes "let me search my memory" (spec §30.3 F.2). */
export const rewordMemory = (memory: string) => memory.replace("You can search your memory at most", "You can look things up at most");

export function fixSections(s: PromptSections): PromptSections {
  return {
    ...s,
    memory: s.memory && rewordMemory(s.memory),
    time: s.time && `${s.time}\n${SUICIDE_RULE}`,
    manner: s.manner && `${s.manner}\n${OPENER_RULE}`,
  };
}

export function buildPromptF(persona: PromptPersona, options: PromptOptions): string {
  const s = fixSections(promptSections(persona, options));
  return joinSections([...SECTION_ORDER.map((k) => s[k]), CLOSING]);
}
