/**
 * Chat types shared by the chat route and the browser. A message's tool trace and
 * sources are stored on the message itself, so they survive a reload and reach
 * exports (spec §5).
 */
import type { VisitEnding } from "./visit";
import type { VisitorAct } from "./visitor-act";

/** Spec §18.4: realistic = the persona understands only languages it spoke; visitor = it follows the visitor. */
export type LanguageMode = "realistic" | "visitor";

export const MAX_MESSAGE_CHARS = 4000;
/** Persona replies can be longer than a user's own message (F2: don't punish the model's own output). */
export const MAX_PERSONA_MESSAGE_CHARS = 20_000;
export const MAX_REQUEST_MESSAGES = 50;
/** Only the most recent messages go to the model (spec §16.2). */
export const HISTORY_WINDOW = 20;
/** Spec §18.7: the cap on acts sent back with a turn. */
export const MAX_ACTS = 500;

/** "running" exists only while a turn streams; saved messages hold "ok" or "error". */
export type ToolCallStatus = "running" | "ok" | "error";

export type ToolCall = {
  id: string;
  toolName: string;
  arguments: Record<string, unknown>;
  status: ToolCallStatus;
  /** The tool's structured result when ok, { error } when it failed; absent while running. */
  result?: unknown;
  durationMs?: number;
};

/** A cited passage: "Chien-Shiung Wu — Parity experiment", not a chunk id. */
export type Source = { personaId: string; sectionHeading: string; chunkId: number };

export type Message = {
  id: string;
  role: "user" | "persona";
  text: string;
  /** Optional, so conversations saved before the chat route existed still load. */
  toolCalls?: ToolCall[];
  sources?: Source[];
  /** Spec §18.1: the classifier's reading of a user message; null when it couldn't read it. */
  act?: VisitorAct | null;
  /** Spec §18.5: set on the persona message that ended the visit. */
  ended?: VisitEnding;
};

/** What the browser sends: text only. Earlier tool traces are not replayed to the model. */
export type ChatRequestMessage = { role: "user" | "persona"; text: string };
export type ChatRequest = {
  personaId: string;
  messages: ChatRequestMessage[];
  /** The acts of every visitor message before the newest, in order (spec §18.7). */
  acts: (VisitorAct | null)[];
  languageMode: LanguageMode;
};

/** One line of the chat route's newline-delimited JSON stream (spec §16.2). */
export type ChatStreamEvent =
  | { type: "notice"; code: "tools_unavailable" }
  | { type: "act"; act: VisitorAct | null }
  | { type: "token"; text: string }
  | { type: "tool_start"; id: string; toolName: string; arguments: Record<string, unknown> }
  | { type: "tool_end"; id: string; status: "ok" | "error"; result: unknown; durationMs: number }
  | { type: "done"; message: { text: string; toolCalls: ToolCall[]; sources: Source[]; ended?: VisitEnding } }
  | { type: "error"; reason: string; retryable: boolean };
