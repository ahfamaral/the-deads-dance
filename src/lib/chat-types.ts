/**
 * Chat types shared by the chat route and the browser. A message's tool trace and
 * sources are stored on the message itself, so they survive a reload and reach
 * exports (spec §5).
 */
import type { VisitEnding } from "./visit";
import type { VisitorAct } from "./visitor-act";

/** Spec §18.4: realistic = the persona understands only languages it spoke; visitor = it follows the visitor. */
export type LanguageMode = "realistic" | "visitor";

/** Spec §33.2: set by a conversation's first turn, never changed. */
export type ConversationMode = "text" | "voice";

export const MAX_MESSAGE_CHARS = 4000;
/** Only the most recent messages go to the model (spec §16.2). */
export const HISTORY_WINDOW = 20;

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

/** Spec §26: what model calls used, in tokens and micro-dollars. Admin-only; testers never get it. */
export type Spend = { tokens: number; cost: number };
export type TurnSpend = Spend & { inputTokens: number; outputTokens: number };

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
  /** Spec §25.3: a partial reply, stored after Stop. */
  stopped?: boolean;
  /** Spec §26.6, admin only: the whole turn's cost and tokens. */
  cost?: number;
  tokens?: number;
};

/** Text only, oldest first: what the model sees of the conversation (spec §25.3). */
export type HistoryMessage = { role: "user" | "persona"; text: string };

/** Spec §25.3: what the browser sends. The server owns the history, so there are no messages or acts. */
export type ChatRequest = {
  conversationId: string;
  personaId: string;
  /** The visitor's new message; absent on Retry. */
  text?: string;
  /** Answer the stored, unanswered visitor message again. */
  retry?: true;
  /** The conversation's first message: only then may the server create it. */
  first?: true;
  languageMode: LanguageMode;
  /** Spec §33.5: how the conversation is held; stored on its first turn, ignored after. Absent = text. */
  mode?: ConversationMode;
  /** Spec §33.5: the spoken language (ISO 639-1); required with voice mode. */
  voiceLanguage?: string;
};

/** One line of the chat route's newline-delimited JSON stream (spec §16.2). */
export type ChatStreamEvent =
  | { type: "notice"; code: "tools_unavailable" }
  | { type: "act"; act: VisitorAct | null }
  | { type: "token"; text: string }
  | { type: "tool_start"; id: string; toolName: string; arguments: Record<string, unknown> }
  | { type: "tool_end"; id: string; status: "ok" | "error"; result: unknown; durationMs: number }
  | { type: "done"; message: { text: string; toolCalls: ToolCall[]; sources: Source[]; ended?: VisitEnding } }
  | { type: "error"; reason: string; retryable: boolean }
  /** Spec §33.5: one spoken chunk, base64 PCM (16-bit little-endian, mono), in seq order. */
  | { type: "audio"; seq: number; data: string; sampleRate: number }
  /** Spec §33.5: this answer's voice was lost; the text still arrives with done. */
  | { type: "audio_error" }
  | { type: "energy"; left: number }
  | { type: "cost"; turn: TurnSpend; conversation: Spend };
