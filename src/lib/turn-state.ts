import type { ChatStreamEvent, Message, ToolCall } from "@/lib/chat-types";
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
  /** Spec §33.5: this answer's voice was lost, so the voice screen shows its text. */
  voiceLost: boolean;
};

export function startTurn(id: string): TurnState {
  return { message: { id, role: "persona", text: "", toolCalls: [], sources: [] }, status: "streaming", toolsUnavailable: false, voiceLost: false };
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
    case "energy":
      return state; // spec §26.5: the screen's meter handles it
    case "audio":
      return state; // spec §33.5: the voice player handles it
    case "audio_error":
      return { ...state, voiceLost: true };
    case "cost":
      return { ...state, message: { ...state.message, cost: event.turn.cost, tokens: event.turn.tokens } };
  }
}

/** Spec §26.4: the server finishes every turn, so only a finished reply is stored; a failed turn stores none. */
export function replyToStore(state: TurnState): Message | null {
  return state.status === "done" ? state.message : null;
}
