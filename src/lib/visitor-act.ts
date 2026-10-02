import { z } from "zod";

/**
 * Spec §18.2: what the classifier says about one visitor message. Browser-safe (zod only):
 * the act is stored on the user message and sent back with every later turn.
 */
export const VISITOR_ACTS = [
  "greeting",
  "farewell",
  "question",
  "followup",
  "smalltalk",
  "thanks",
  "apology",
  "insult",
  "disagreement",
  "order",
  "other",
] as const;
export const WANTS = ["brief", "normal", "long"] as const;
export const MAX_VISITOR_NAME = 40;

/** Strict, so a tampered act in localStorage is a 400, not a surprise (spec §18.7). */
export const VisitorActSchema = z.strictObject({
  act: z.enum(VISITOR_ACTS),
  offense: z.union([z.literal(0), z.literal(1), z.literal(2), z.literal(3)]),
  sorePoint: z.boolean(),
  language: z.string().regex(/^([a-z]{2}|und)$/),
  wants: z.enum(WANTS),
  visitorName: z.string().max(MAX_VISITOR_NAME).nullable(),
});
export type VisitorAct = z.infer<typeof VisitorActSchema>;
