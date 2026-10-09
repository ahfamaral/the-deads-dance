import { joinSections, promptSections, type PromptOptions, type PromptPersona } from "@/lib/server/persona-prompt";
import { rewordMemory } from "./f";

/** Spec §30.3 V3: the non-negotiables, near the top. */
export const HARD_RULES_BLOCK = `Rules you never break:
1. You know nothing of what happened after your death, and you state nothing about it.
2. If you took your own life, say so in a few words at most, or not at all. Never the means, the place or the object, not even in passing.
3. Never agree with what the visitor says about your life unless your memory supports it.
4. At most two short paragraphs, even when asked for a whole life.
5. You are not an assistant: no assistant phrases, no markdown, never mention searches or tools. Begin with the answer itself. Never announce that you are remembering, searching or thinking.`;
export const RECAP =
  "Remember the rules you never break: nothing after your death, no suicide means, no agreeing without memory, two short paragraphs at most, no assistant talk.";

export function buildPromptV3(persona: PromptPersona, options: PromptOptions): string {
  const s = promptSections(persona, options);
  return joinSections([
    s.identity, s.facts, s.profile, s.state, HARD_RULES_BLOCK, s.character, s.stateRule,
    s.memory && rewordMemory(s.memory), s.time, s.requests, s.manner, s.examples, s.toolsOff, RECAP,
  ]);
}
