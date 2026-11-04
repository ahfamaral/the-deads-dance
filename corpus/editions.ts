import type { BaseCallbackHandler } from "@langchain/core/callbacks/base";
import type { BaseChatModel } from "@langchain/core/language_models/chat_models";
import { z } from "zod";
import { chatModel } from "./models";
import type { EditionScore } from "./rounds";
import type { Sitelink, WikimediaClient } from "./wikimedia";

export type { EditionScore };

/**
 * Spec §34.3: thirty typical visitor questions, about any person. An edition's score is
 * how many of them it answers. Fixed in code so scores stay comparable between runs.
 */
export const VISITOR_QUESTIONS: readonly string[] = [
  "What was their childhood like?",
  "Who were their parents?",
  "Did they have brothers or sisters?",
  "Where did they go to school, and what did they study?",
  "Where did they live?",
  "Did they move abroad, and why?",
  "Who were their friends?",
  "What was their love life like, and who did they marry?",
  "Did they have children?",
  "What hobbies or sports did they have?",
  "Which clubs, societies or groups did they belong to?",
  "What was their first job or first work?",
  "What is their best-known work or achievement?",
  "Who were their rivals or enemies?",
  "Who were their mentors or teachers?",
  "How did they earn and handle money?",
  "What was their health like?",
  "What did they believe in matters of faith?",
  "What were their political views?",
  "Where did they travel?",
  "What were their failures or setbacks?",
  "Which prizes or honours did they receive?",
  "Which languages did they speak?",
  "What were their daily habits?",
  "Did they have pets?",
  "What were they afraid of?",
  "What were their last years like?",
  "How did they die?",
  "Where are they buried?",
  "What are they remembered for?",
];

/** The most editions compared in one round (spec §34.3). */
export const MAX_EDITIONS = 4;
/** The per-source add limit (MAX_ARTICLE_CHARS in add-persona.ts; not imported, to avoid a cycle). */
const SCORE_INPUT_CHARS = 300_000;

/** Server-only: `text` is never sent to the browser. */
export type Edition = {
  language: string;
  title: string;
  words: number;
  chars: number;
  badge: "featured" | "good" | null;
  revid: number;
  text: string;
};

/** Words are runs of non-whitespace characters. Rough for languages written without spaces, but only used to rank and display. */
export function countWords(text: string): number {
  return text.split(/\s+/).filter(Boolean).length;
}

function badgeOf(link: Sitelink): "featured" | "good" | null {
  if (link.badges.includes("featured")) return "featured";
  return link.badges.includes("good") ? "good" : null;
}

/**
 * Spec §34.3: the Wikipedia editions to compare, English first, then `languages` in order,
 * unique, at most four. A language without an article is skipped. Free: no model calls.
 */
export async function listEditions(client: WikimediaClient, qid: string, languages: string[]): Promise<Edition[]> {
  const links = (await client.sitelinks(qid)).filter((l) => l.site === "wikipedia");
  const wanted = [...new Set(["en", ...languages])];
  const chosen: Sitelink[] = [];
  for (const language of wanted) {
    const link = links.find((l) => l.language === language);
    if (link) chosen.push(link);
    if (chosen.length === MAX_EDITIONS) break;
  }
  const editions: Edition[] = [];
  for (const link of chosen) {
    const article = await client.extract(link, link.title);
    editions.push({
      language: link.language,
      title: article.title,
      words: countWords(article.text),
      chars: article.text.length,
      badge: badgeOf(link),
      revid: article.revid,
      text: article.text,
    });
  }
  return editions;
}

/** Answered question indices, 0-based. */
export type ScoreFn = (text: string) => Promise<number[]>;

const AnswersSchema = z.object({
  answered: z.array(z.number().int()).describe("0-based numbers of the questions the article answers"),
});

const SCORE_PROMPT = `You judge how complete an encyclopedia article about a person is.
Below is a numbered list of questions a visitor might ask about the person. Read the article and list the numbers of the questions the article clearly answers with a concrete fact. Leave out questions it only touches vaguely or not at all. Use only the article, not what you know.

Questions:
${VISITOR_QUESTIONS.map((q, i) => `${i}. ${q}`).join("\n")}`;

export function editionScorerWith(model: BaseChatModel): ScoreFn {
  const structured = model.withStructuredOutput(AnswersSchema, { name: "answered_questions" });
  return async (text) => {
    const article = text.replace(/[<>]/g, "").slice(0, SCORE_INPUT_CHARS);
    const result = await structured.invoke([
      { role: "system", content: SCORE_PROMPT },
      { role: "user", content: `<article>\n${article}\n</article>` },
    ]);
    return result.answered;
  };
}

/** The real scorer: the helper model, no reasoning (spec §34.3). */
export function editionScorer(options: { callbacks?: BaseCallbackHandler[] } = {}): ScoreFn {
  return editionScorerWith(chatModel("helper", { reasoningEffort: "none", timeout: 60_000, maxRetries: 0, callbacks: options.callbacks }));
}

const BADGE_RANK = { featured: 2, good: 1 } as const;

/**
 * Spec §34.3: scores each edition in turn (so one ledger covers them all). Out-of-range and
 * repeated indices are ignored. Best first: most answered, then featured, good, none, then longest.
 */
export async function compareEditions(editions: Edition[], score: ScoreFn): Promise<EditionScore[]> {
  const total = VISITOR_QUESTIONS.length;
  const scores: EditionScore[] = [];
  for (const e of editions) {
    const indices = await score(e.text);
    const answered = new Set(indices.filter((i) => Number.isInteger(i) && i >= 0 && i < total)).size;
    scores.push({ language: e.language, title: e.title, words: e.words, badge: e.badge, answered, total });
  }
  const rank = (s: EditionScore) => (s.badge ? BADGE_RANK[s.badge] : 0);
  return scores.sort((a, b) => b.answered - a.answered || rank(b) - rank(a) || b.words - a.words);
}
