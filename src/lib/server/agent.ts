import { BaseCallbackHandler } from "@langchain/core/callbacks/base";
import type { LLMResult } from "@langchain/core/outputs";
import { AIMessage as AIMessageClass, SystemMessage, createAgent, createMiddleware, modelCallLimitMiddleware, toolCallLimitMiddleware, type AIMessage, type BaseMessage, type ToolMessage } from "langchain";
import type { ToolEnvelope } from "./persona-tools";
import { MAX_TOOL_CALLS } from "./turn-limits";

type AgentParams = Parameters<typeof createAgent>[0];
/** A ChatOpenAI in the app; fakeModel() in tests. */
export type AgentModel = AgentParams["model"];
export type AgentTools = AgentParams["tools"];

export const MAX_MODEL_CALLS = 6;
// Spec §28.2: further calls are blocked with an error message, and the persona answers from what it has.
export { MAX_TOOL_CALLS };
// Each model round is up to five graph steps (two limit hooks, the model, two more hooks, the tools);
// LangGraph's default of 25 would stop a turn that used all its lookups before it answered.
const RECURSION_LIMIT = 50;

/** Spec §28.2: closes the request once this turn's lookups are used up. */
export const LOOKUPS_USED_NOTE =
  "You have used all your searches for this answer. Answer the visitor now from what you found, without calling any tool.";

/**
 * Spec §28.2: once this turn's lookups are used up, the model gets no tools and a closing note saying
 * so. toolCallLimitMiddleware alone would block a further call and end the turn with no answer. The
 * probe (§28.5) showed DeepSeek ignoring tool_choice "none" and calling a tool even with none offered,
 * so a call it still makes is dropped, and its text, if any, is the answer. A reply with no text (the
 * probe saw one that was all reasoning) is asked for once more.
 */
export const lookupLimit = createMiddleware({
  name: "LookupLimit",
  wrapModelCall: async (request, handler) => {
    const lastHuman = request.messages.findLastIndex((m) => m.type === "human");
    const used = request.messages.slice(lastHuman + 1).filter((m) => m.type === "tool").length;
    if (used < MAX_TOOL_CALLS) return handler(request);
    const ask = () => handler({ ...request, tools: [], toolChoice: undefined, messages: [...request.messages, new SystemMessage(LOOKUPS_USED_NOTE)] });
    const hasText = (r: unknown) => AIMessageClass.isInstance(r) && typeof r.content === "string" && r.content.trim() !== "";
    let reply = await ask();
    if (AIMessageClass.isInstance(reply) && !hasText(reply)) reply = await ask();
    if (!AIMessageClass.isInstance(reply) || !reply.tool_calls?.length) return reply;
    return new AIMessageClass({ content: reply.content, id: reply.id, response_metadata: reply.response_metadata, usage_metadata: reply.usage_metadata });
  },
});

export type TurnEvent =
  | { type: "token"; text: string }
  | { type: "tool_start"; id: string; toolName: string; arguments: Record<string, unknown> }
  | { type: "tool_end"; id: string; envelope: ToolEnvelope }
  /** Spec §28.2: a model message hit max_tokens. Internal: chatEvents trims the reply, the browser never sees it. */
  | { type: "truncated" };

/**
 * Spec §28.2: whether a model call hit max_tokens. A streamed ChatOpenAI reply keeps finish_reason in
 * generationInfo, not in the message's response_metadata, so a callback sees it where the stream can't.
 */
class FinishWatcher extends BaseCallbackHandler {
  name = "FinishWatcher";
  truncated = false;
  async handleLLMEnd(output: LLMResult) {
    for (const generation of output.generations.flat()) {
      if (generation.generationInfo?.finish_reason === "length") this.truncated = true;
    }
  }
}

function isEnvelope(value: unknown): value is ToolEnvelope {
  return typeof value === "object" && value !== null && "ok" in value && typeof value.ok === "boolean";
}

/**
 * One agent turn as a stream of events. Uses stream modes "messages" (tokens, tool
 * results) and "updates" (complete tool calls), as the langchain-v1 skill describes.
 */
export async function* runTurn(opts: {
  model: AgentModel;
  tools: AgentTools;
  systemPrompt: string;
  messages: { role: "user" | "assistant"; content: string }[];
  signal?: AbortSignal;
  callbacks?: BaseCallbackHandler[];
}): AsyncGenerator<TurnEvent> {
  const agent = createAgent({
    model: opts.model,
    tools: opts.tools,
    systemPrompt: opts.systemPrompt,
    // "error" throws ModelCallLimitMiddlewareError; "end" would show the limit text as the persona's reply.
    middleware: [
      modelCallLimitMiddleware({ runLimit: MAX_MODEL_CALLS, exitBehavior: "error" }),
      // Blocks the calls past the limit within one model message; lookupLimit stops the next round asking.
      toolCallLimitMiddleware({ runLimit: MAX_TOOL_CALLS, exitBehavior: "continue" }),
      lookupLimit,
    ],
  });
  const watcher = new FinishWatcher();
  const stream = await agent.stream(
    { messages: opts.messages },
    { streamMode: ["messages", "updates"], signal: opts.signal, callbacks: [...(opts.callbacks ?? []), watcher], recursionLimit: RECURSION_LIMIT },
  );
  // A fake model (tests) sets finish_reason on the message itself.
  let truncated = false;

  for await (const [mode, chunk] of stream as AsyncIterable<[string, unknown]>) {
    if (mode === "messages") {
      const [msg, meta] = chunk as [BaseMessage, { langgraph_node?: string }];
      if (msg.type === "ai" && meta.langgraph_node === "model_request" && typeof msg.content === "string" && msg.content) {
        yield { type: "token", text: msg.content };
      } else if (msg.type === "tool") {
        const toolMessage = msg as ToolMessage;
        // ToolMessage.status is unset on errors, so the envelope decides.
        const envelope: ToolEnvelope = isEnvelope(toolMessage.artifact)
          ? toolMessage.artifact
          : { ok: false, error: typeof toolMessage.content === "string" ? toolMessage.content : "The tool failed." };
        yield { type: "tool_end", id: toolMessage.tool_call_id, envelope };
      }
    } else if (mode === "updates") {
      // Only model_request: middleware nodes (e.g. ModelCallLimitMiddleware.after_model) re-emit the same message.
      const update = chunk as { model_request?: { messages?: BaseMessage[] } };
      const last = update.model_request?.messages?.at(-1) as AIMessage | undefined;
      for (const call of last?.tool_calls ?? []) {
        yield { type: "tool_start", id: call.id ?? "", toolName: call.name, arguments: call.args };
      }
      if (last?.response_metadata?.finish_reason === "length") truncated = true;
    }
  }
  if (truncated || watcher.truncated) yield { type: "truncated" };
}
