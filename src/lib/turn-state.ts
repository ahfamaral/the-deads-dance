import type { ChatStreamEvent, Message, ToolCall } from "@/lib/chat-types";
import type { VisitEnding } from "@/lib/visit";
import type { VisitorAct } from "@/lib/visitor-act";

/**
 * Spec §25.3 step 8: builds a turn's persona message from the stream's events. Pure, and shared:
 * the browser renders with it, and the chat route builds the reply it stores with it, so the two
 * always agree.
 */

export type TurnState = {
  /** The persona message being built. */
  message: Message;
  status: "streaming" | "done" | "error";
  error?: { reason: string; retryable: boolean };
  toolsUnavailable: boolean;
  /** The server's reading of the user message this turn answers (spec §18.1). */
  act?: VisitorAct | null;
};

export function startTurn(id: string): TurnState {
  return { message: { id, role: "persona", text: "", toolCalls: [], sources: [] }, status: "streaming", toolsUnavailable: false };
}

function updateCalls(message: Message, update: (calls: ToolCall[]) => ToolCall[]): Message {
  return { ...message, toolCalls: update(message.toolCalls ?? []) };
}

/** Folds one stream event into the turn. Pure, so it's tested without a browser. */
export function applyChatEvent(state: TurnState, event: ChatStreamEvent): TurnState {
  switch (event.type) {
    case "act":
      return { ...state, act: event.act };
    case "notice":
      return { ...state, toolsUnavailable: true };
    case "token":
      return { ...state, message: { ...state.message, text: state.message.text + event.text } };
    case "tool_start":
      return {
        ...state,
        message: updateCalls(state.message, (calls) => [
          ...calls,
          { id: event.id, toolName: event.toolName, arguments: event.arguments, status: "running" },
        ]),
      };
    case "tool_end":
      return {
        ...state,
        message: updateCalls(state.message, (calls) =>
          calls.map((c) =>
            c.id === event.id ? { ...c, status: event.status, result: event.result, durationMs: event.durationMs } : c,
          ),
        ),
      };
    case "done":
      return { ...state, status: "done", message: { ...state.message, ...event.message } };
    case "error":
      return { ...state, status: "error", error: { reason: event.reason, retryable: event.retryable } };
  }
}

/** Stop pressed: keep the text received so far, or nothing if no text arrived yet. */
export function stoppedMessage(state: TurnState): Message | null {
  if (!state.message.text.trim()) return null;
  return updateCalls(state.message, (calls) => calls.filter((c) => c.status !== "running"));
}

/** What the server stores once a turn's stream ends. */
export type StoredReply = { message: Message; stopped: boolean };

/**
 * Spec §25.3 step 9: a finished reply as it is; after Stop, the text so far, marked stopped and
 * carrying this turn's ending; nothing for a failed turn or a Stop before any text, which leaves
 * the visitor message unanswered and retryable.
 */
export function replyToStore(state: TurnState, opts: { aborted: boolean; ended: VisitEnding | null }): StoredReply | null {
  if (state.status === "done") return { message: state.message, stopped: false };
  if (state.status === "error" || !opts.aborted) return null;
  const partial = stoppedMessage(state);
  if (!partial) return null;
  return { message: opts.ended ? { ...partial, ended: opts.ended } : partial, stopped: true };
}
