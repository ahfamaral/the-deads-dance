import { type ChatStreamEvent, type ConversationMode, type LanguageMode } from "@/lib/chat-types";
import { readNdjson } from "@/lib/ndjson";

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

export async function* streamChat(opts: {
  conversationId: string;
  personaId: string;
  /** The visitor's new message; ignored on Retry. */
  text?: string;
  /** Answer the stored, unanswered visitor message again (spec §25.3). */
  retry?: boolean;
  /** The conversation's first message: only then may the server create it. */
  first?: boolean;
  languageMode?: LanguageMode;
  /** Spec §33.5: how the conversation is held; the server keeps what the first turn says. */
  mode?: ConversationMode;
  voiceLanguage?: string;
  /** Aborted when the chat closes; the server finishes the turn anyway (spec §26.4). */
  signal?: AbortSignal;
}): AsyncGenerator<ChatStreamEvent> {
  let res: Response;
  try {
    res = await fetch("/api/chat", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        conversationId: opts.conversationId,
        personaId: opts.personaId,
        ...(opts.retry ? { retry: true } : { text: opts.text, ...(opts.first ? { first: true } : {}) }),
        languageMode: opts.languageMode ?? "realistic",
        ...(opts.mode ? { mode: opts.mode } : {}),
        ...(opts.voiceLanguage ? { voiceLanguage: opts.voiceLanguage } : {}),
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
    throw new ChatRequestError("The reply was interrupted.", true, "stream_interrupted");
  }
}
