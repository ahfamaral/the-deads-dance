import type { ChatStreamEvent, Source, ToolCall } from "@/lib/chat-types";
import { passagesIn } from "@/lib/tool-display";
import type { VisitEnding } from "@/lib/visit";
import type { TurnEvent } from "./agent";

/** Every passage the turn's tools returned, once each. Simplification (spec §16.2): retrieved counts as cited. */
export function sourcesFrom(toolCalls: ToolCall[], personaId: string): Source[] {
  const sources = new Map<number, Source>();
  for (const call of toolCalls) {
    if (call.status !== "ok") continue;
    for (const p of passagesIn(call.result)) {
      if (!sources.has(p.chunk_id)) {
        sources.set(p.chunk_id, { personaId, sectionHeading: p.section_heading, chunkId: p.chunk_id });
      }
    }
  }
  return [...sources.values()];
}

/** Agent middleware wraps a model error and keeps the provider's error as its cause (spec §28.2). */
function httpStatus(err: unknown): number | undefined {
  if (typeof err !== "object" || err === null) return undefined;
  if ("status" in err && typeof err.status === "number") return err.status;
  return "cause" in err ? httpStatus(err.cause) : undefined;
}

export function describeTurnError(err: unknown): { reason: string; retryable: boolean } {
  if (err instanceof Error && err.name === "ModelCallLimitMiddlewareError") {
    return { reason: "The persona got stuck. Try rephrasing.", retryable: true };
  }
  const status = httpStatus(err);
  // Spec §26.4: the OpenRouter key is out of credit. Calm, and no money mentioned.
  if (status === 402) return { reason: "The dead are resting right now. Try again later.", retryable: false };
  if (status === 401 || status === 403) {
    return { reason: "The model provider rejected the API key. Check OPENROUTER_API_KEY.", retryable: false };
  }
  if (status === 400 || status === 404) {
    return { reason: "The model rejected the request. Check AGENT_MODEL.", retryable: false };
  }
  if (status === 429) return { reason: "The model is rate-limited right now. Try again in a moment.", retryable: true };
  return { reason: "The model is unavailable right now. Try again.", retryable: true };
}

function isAbort(err: unknown): boolean {
  return err instanceof Error && err.name === "AbortError";
}

/**
 * Spec §28.2: a reply cut off by max_tokens ends at its last full sentence: the last ., !, ? or …
 * followed by a space or the end, with any closing quotes or brackets. A full stop after a title or
 * "c." (circa) doesn't end a sentence. With none, it trails off.
 */
const SENTENCE_END = /^[\s\S]*(?:[!?…]|(?<!\b(?:Mr|Mrs|Ms|Dr|St|Sr|Jr|Sra|Dra|c))\.)["'”’»)\]]*(?=\s|$)/;

export function trimToSentence(text: string): string {
  const match = text.match(SENTENCE_END);
  return match ? match[0] : `${text.trimEnd()}…`;
}

/**
 * Turns the agent's events into the stream the browser reads: forwards tokens and tool
 * events (adding durations), then sends the finished message with its trace and sources.
 */
export async function* chatEvents(opts: {
  turn: AsyncIterable<TurnEvent>;
  personaId: string;
  now?: () => number;
  ended?: VisitEnding | null;
}): AsyncGenerator<ChatStreamEvent> {
  const now = opts.now ?? Date.now;
  const calls = new Map<string, ToolCall>();
  const startedAt = new Map<string, number>();
  let text = "";
  // F4: tokens from separate model steps (before/after a tool call) run together otherwise,
  // e.g. "Let me check.I joined…". Only insert once, right after a tool ends.
  let afterToolEnd = false;
  let truncated = false;

  try {
    for await (const event of opts.turn) {
      if (event.type === "token") {
        if (afterToolEnd && text && !/\s$/.test(text)) {
          text += "\n\n";
          yield { type: "token", text: "\n\n" };
        }
        afterToolEnd = false;
        text += event.text;
        yield event;
      } else if (event.type === "truncated") {
        truncated = true;
      } else if (event.type === "tool_start") {
        startedAt.set(event.id, now());
        calls.set(event.id, { id: event.id, toolName: event.toolName, arguments: event.arguments, status: "running" });
        yield event;
      } else {
        const durationMs = now() - (startedAt.get(event.id) ?? now());
        const status = event.envelope.ok ? "ok" : "error";
        const result = event.envelope.ok ? event.envelope.data : { error: event.envelope.error };
        const call = calls.get(event.id);
        if (call) calls.set(event.id, { ...call, status, result, durationMs });
        afterToolEnd = true;
        yield { type: "tool_end", id: event.id, status, result, durationMs };
      }
    }
  } catch (err) {
    if (isAbort(err)) return; // the user stopped or left; nobody is listening
    console.error(err);
    yield { type: "error", ...describeTurnError(err) };
    return;
  }

  const toolCalls = [...calls.values()].map((call): ToolCall =>
    call.status === "running" ? { ...call, status: "error", result: { error: "The tool didn't finish." } } : call,
  );
  if (!text.trim()) {
    yield { type: "error", reason: "The persona didn't answer. Try rephrasing.", retryable: true };
    return;
  }
  yield {
    type: "done",
    message: {
      text: truncated ? trimToSentence(text) : text,
      toolCalls,
      sources: sourcesFrom(toolCalls, opts.personaId),
      ...(opts.ended ? { ended: opts.ended } : {}),
    },
  };
}
