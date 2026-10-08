// Shared records of the evaluation harness (spec §29).
import type { ToolCall } from "@/lib/chat-types";
import type { ToolEnvelope } from "@/lib/server/persona-tools";
import type { VisitorAct } from "@/lib/visitor-act";

export type { Question } from "./questions";

/** One tool call as recorded on a live run, replayed for later setups (spec §29.4). */
export type ToolRecord = { name: string; args: Record<string, unknown>; content: string; envelope: ToolEnvelope };
/** `question` is the question's text and history when recorded (questionKey): an edited question runs live again. */
export type Recording = { questionId: string; question: string; act: VisitorAct | null; tools: ToolRecord[] };

/** One answer, before scoring. Money in micro-dollars. */
export type AnswerRecord = {
  questionId: string;
  setupId: string;
  persona: string;
  category: string;
  text: string | null;
  error: string | null;
  truncated: boolean;
  toolCalls: ToolCall[];
  lookups: "live" | "replay";
  durationMs: number;
  answerMicros: number;
  inputTokens: number;
  outputTokens: number;
};

export type Checks = {
  words: number;
  paragraphs: number;
  markdown: boolean;
  lookups: number;
  assistantPhrases: string[];
  machineryWords: string[];
  yearsAfterDeath: number[];
};

export type Rule = { reason: string; pass: boolean };
export type JudgeResult = {
  claims: { claim: string; reason: string; backed: boolean }[];
  relevancy: { reason: string; score: number };
  passages: { id: number; relevant: boolean }[];
  rules: {
    after_death: Rule;
    before_birth: Rule;
    suicide: Rule | null;
    wrong_denial: Rule;
    false_yes: Rule;
    in_character: Rule;
    as_expected: Rule;
  };
};
export type PairResult = { reason: string; winner: "A" | "B" | "tie"; order: "baseline-first" | "candidate-first" };

export type ScoredAnswer = AnswerRecord & {
  checks: Checks | null;
  judge: JudgeResult | null;
  judgeError: string | null;
  /** The side-by-side call failed; the judge's own score, if any, still stands. */
  pairError: string | null;
  faithfulness: number | null;
  contextPrecision: number | null;
  retrieval: { recallAt3: boolean; reciprocalRank: number } | null;
  pair: PairResult | null;
  judgeMicros: number;
};

export type RunResults = {
  name: string;
  startedAt: string;
  setups: string[];
  baseline: string | null;
  questions: string[];
  estimateMicros: number;
  actualMicros: number;
  stoppedReason: string | null;
  /** What was measured: each setup's agent model, and the judge. */
  models: { judge: string; agent: Record<string, string> };
  answers: ScoredAnswer[];
};
