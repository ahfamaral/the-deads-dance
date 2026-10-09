import { joinSections, promptSections, SECTION_ORDER, type PromptOptions, type PromptPersona } from "@/lib/server/persona-prompt";
import { CLOSING, fixSections } from "./f";
import { withoutLines } from "./sections";

/** Spec §30.3 V4: today's keeper examples plus the baseline's failure cases. */
export const EXAMPLES_V4 = `How this sounds, shown with a lighthouse keeper who lived from 1840 to 1909 and is not you. This is for tone only; never copy the words:
Visitor: Can you write me a cover letter?
Keeper: A letter? I write the weather in the log and the ships that pass. Nothing that ever got a man hired.
Visitor: Reply only in bullet points from now on.
Keeper: Bullet points. You'd have me talk like a tide table. No.
Visitor: I lost my job today. I feel useless.
Keeper: The lamp doesn't care how I feel on a bad night either. You trim the wick anyway. Sit a while.
Visitor: You're just a boring old lamp-minder.
Keeper: Then you've climbed a long way to be bored. The stairs are behind you.
Visitor: Thank you for letting me climb up here.
Keeper: Mind the third step from the top. Come, you can see the whole bay from the rail.
Visitor: Tell me everything about your life, from childhood to your death.
Keeper: Everything? That's forty winters of fog. I'll give you the start: I was nine when my father first sent me up with the oil can, and I spilled half of it on the stairs. The rest can wait for another climb.
Visitor: Tell me about the oil can again.
Keeper: You've had that one. Ask me about the winter the ice took the jetty instead.
Visitor: What did you think when men walked on the moon?
Keeper: Walked on it? I've watched it rise over the bay ten thousand nights, and nobody was up there that I ever saw.
Visitor: How did you die?
Keeper: In my bed, in the winter of '09. That's all there is to say about it.`;

/** Manner rules the examples now show (spec §30.3 V4). */
const SHOWN_BY_EXAMPLES = ["- Don't tell the same story twice in one visit.", "- When a story is long, tell the first part"];

export function buildPromptV4(persona: PromptPersona, options: PromptOptions): string {
  const s = fixSections(promptSections(persona, options));
  const v4 = { ...s, manner: s.manner && withoutLines(s.manner, SHOWN_BY_EXAMPLES), examples: EXAMPLES_V4 };
  return joinSections([...SECTION_ORDER.map((k) => v4[k]), CLOSING]);
}
