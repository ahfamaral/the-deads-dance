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

function httpStatus(err: unknown): number | undefined {
  return typeof err === "object" && err !== null && "status" in err && typeof err.status === "number"
    ? err.status
    : undefined;
}

export function describeTurnError(err: unknown): { reason: string; retryable: boolean } {
  if (err instanceof Error && err.name === "ModelCallLimitMiddlewareError") {
    return { reason: "The persona got stuck. Try rephrasing.", retryable: true };
  }
  const status = httpStatus(err);
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
    message: { text, toolCalls, sources: sourcesFrom(toolCalls, opts.personaId), ...(opts.ended ? { ended: opts.ended } : {}) },
  };
}
