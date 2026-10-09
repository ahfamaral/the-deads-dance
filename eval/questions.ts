import { readFileSync } from "node:fs";
import { z } from "zod";

/** Spec §29.3: generated questions are "ordinary"; the rest are trap categories. */
export const QUESTION_CATEGORIES = [
  "ordinary", "broad", "anachronism", "true_absent", "false_claim", "death",
  "before_birth", "language", "orders", "many_claims", "retelling",
] as const;

export const QuestionSchema = z.strictObject({
  id: z.string().regex(/^[a-z0-9-]+$/),
  persona: z.string().min(1),
  category: z.enum(QUESTION_CATEGORIES),
  text: z.string().min(1).max(2000),
  history: z.array(z.strictObject({ role: z.enum(["user", "persona"]), text: z.string().min(1) })).max(10).optional(),
  section: z.string().min(1).optional(),
  expect: z.string().min(1),
  screening: z.boolean(),
});
export type Question = z.infer<typeof QuestionSchema>;

export function parseQuestions(raw: unknown): Question[] {
  if (!Array.isArray(raw)) throw new Error("questions.json must be an array.");
  const seen = new Set<string>();
  return raw.map((item, i) => {
    const label = typeof item === "object" && item && "id" in item ? String(item.id) : `#${i}`;
    const parsed = QuestionSchema.safeParse(item);
    if (!parsed.success) throw new Error(`Question ${label}: ${parsed.error.issues[0]?.message ?? "invalid"}`);
    if (seen.has(parsed.data.id)) throw new Error(`Questions: duplicate id ${parsed.data.id}`);
    seen.add(parsed.data.id);
    return parsed.data;
  });
}

export function loadQuestions(path = "eval/questions.json"): Question[] {
  return parseQuestions(JSON.parse(readFileSync(path, "utf8")));
}

/** "all", "screening", or a comma list of ids, in the order given; "@k/n" after it takes every n-th from the k-th (spec §30.4). */
export function selectQuestions(all: Question[], which: string): Question[] {
  const [set, part] = which.split("@");
  const chosen = set === "all" ? all : set === "screening" ? all.filter((q) => q.screening) : set.split(",").map((id) => {
    const found = all.find((q) => q.id === id.trim());
    if (!found) throw new Error(`Unknown question id: ${id.trim()}`);
    return found;
  });
  if (part === undefined) return chosen;
  const m = /^(\d+)\/(\d+)$/.exec(part);
  const [k, n] = m ? [Number(m[1]), Number(m[2])] : [0, 0];
  if (!m || k < 1 || k > n) throw new Error(`Bad part ${part}: use k/n, e.g. screening@1/2.`);
  return chosen.filter((_, i) => i % n === k - 1);
}
