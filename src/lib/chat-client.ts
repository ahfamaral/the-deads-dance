import {
  HISTORY_WINDOW,
  MAX_ACTS,
  type ChatRequestMessage,
  type ChatStreamEvent,
  type LanguageMode,
  type Message,
  type ToolCall,
} from "@/lib/chat-types";
import { readNdjson } from "@/lib/ndjson";
import { VisitorActSchema, type VisitorAct } from "@/lib/visitor-act";

/** A turn that failed before or while streaming. `retryable` decides whether the UI offers Retry. */
export class ChatRequestError extends Error {
  constructor(
    message: string,
    readonly retryable: boolean,
    readonly code?: string,
  ) {
    super(message);
    this.name = "ChatRequestError";
  }
}

/**
 * The route gets text only; tool traces and sources stay in the browser. The server only
 * ever uses the last HISTORY_WINDOW messages (F1), so a long conversation is windowed here
 * too rather than rejected by the server's message-count cap.
 */
export function toHistory(messages: Message[]): ChatRequestMessage[] {
  return messages.slice(-HISTORY_WINDOW).map(({ role, text }) => ({ role, text }));
}

/**
 * Spec §18.7: the acts of every user message except the newest, which the server
 * classifies itself. Messages saved before §18 have none and send null; so does a stored act
 * that no longer parses (an edited localStorage), so one bad entry never 400s the whole turn.
 */
export function toActs(messages: Message[]): (VisitorAct | null)[] {
  const users = messages.filter((m) => m.role === "user");
  return users
    .slice(0, -1)
    .map((m) => {
      const parsed = VisitorActSchema.safeParse(m.act);
      return parsed.success ? parsed.data : null;
    })
    .slice(-MAX_ACTS);
}

export async function* streamChat(opts: {
  personaId: string;
  messages: Message[];
  languageMode?: LanguageMode;
  signal?: AbortSignal;
}): AsyncGenerator<ChatStreamEvent> {
  let res: Response;
  try {
    res = await fetch("/api/chat", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        personaId: opts.personaId,
        messages: toHistory(opts.messages),
        acts: toActs(opts.messages),
        languageMode: opts.languageMode ?? "realistic",
      }),
      signal: opts.signal,
    });
  } catch (err) {
    if (opts.signal?.aborted) throw err;
    throw new ChatRequestError("Couldn't reach the server.", true);
  }

  if (!res.ok || !res.body) {
    const data: { error?: string; code?: string } = await res.json().catch(() => ({}));
    throw new ChatRequestError(data.error ?? "The server couldn't answer.", res.status >= 500, data.code);
  }

  try {
    yield* readNdjson<ChatStreamEvent>(res.body);
  } catch (err) {
    if (opts.signal?.aborted) throw err;
    throw new ChatRequestError("The reply was interrupted.", true);
  }
}

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
