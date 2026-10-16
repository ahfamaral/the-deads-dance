import { z } from "zod";

/**
 * Spec §32: a tester's rating of one conversation. Browser-safe: the sheet, History, the admin
 * view and the server all use these.
 */

/** Spec §32.2: the longest comment the server accepts, after trimming. */
export const COMMENT_MAX = 2000;

/** Spec §32.3: the PUT body. A missing comment is ''; one longer than COMMENT_MAX is refused, not cut. */
export const FeedbackInputSchema = z.object({
  stars: z.number().int().min(1).max(5),
  comment: z.string().trim().max(COMMENT_MAX).default(""),
});

export type Feedback = { stars: number; comment: string };

/** One row of the admin's Feedback list (spec §32.7). */
export type FeedbackItem = {
  conversationId: string;
  stars: number;
  comment: string;
  /** The tester's email. */
  email: string;
  personaName: string;
  /** ISO timestamp of the first save; the list is newest first by it. */
  createdAt: string;
  /** Changed after the first save. */
  edited: boolean;
};

export type PersonaAverage = { personaName: string; count: number; average: number };
export type FeedbackSummary = { count: number; average: number | null; perPersona: PersonaAverage[] };
export type FeedbackReport = { summary: FeedbackSummary; items: FeedbackItem[] };

/** The sheet's Send: a star is picked and the comment fits. */
export function canSend(stars: number | null, comment: string): boolean {
  return stars !== null && comment.trim().length <= COMMENT_MAX;
}

/** "★★★★☆" for 4. */
export function starsText(stars: number): string {
  return "★".repeat(stars) + "☆".repeat(5 - stars);
}

/** Spec §32.6: the short form on History rows, "★ 4"; null when unrated. */
export function starsBadge(stars: number | null): string | null {
  return stars === null ? null : `★ ${stars}`;
}

const oneDecimal = (n: number) => Math.round(n * 10) / 10;
const mean = (xs: number[]) => oneDecimal(xs.reduce((a, b) => a + b, 0) / xs.length);

/** Spec §32.7: the count and average overall, then per persona by count (most rated first), then name. */
export function summarizeFeedback(items: Pick<FeedbackItem, "stars" | "personaName">[]): FeedbackSummary {
  if (items.length === 0) return { count: 0, average: null, perPersona: [] };
  const byPersona = new Map<string, number[]>();
  for (const item of items) byPersona.set(item.personaName, [...(byPersona.get(item.personaName) ?? []), item.stars]);
  const perPersona = [...byPersona.entries()]
    .map(([personaName, stars]) => ({ personaName, count: stars.length, average: mean(stars) }))
    .sort((a, b) => b.count - a.count || a.personaName.localeCompare(b.personaName));
  return { count: items.length, average: mean(items.map((i) => i.stars)), perPersona };
}
