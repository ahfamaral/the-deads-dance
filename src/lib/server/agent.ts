import type { BaseCallbackHandler } from "@langchain/core/callbacks/base";
import { createAgent, modelCallLimitMiddleware, type AIMessage, type BaseMessage, type ToolMessage } from "langchain";
import type { ToolEnvelope } from "./persona-tools";

type AgentParams = Parameters<typeof createAgent>[0];
/** A ChatOpenAI in the app; fakeModel() in tests. */
export type AgentModel = AgentParams["model"];
export type AgentTools = AgentParams["tools"];

export const MAX_MODEL_CALLS = 6;

export type TurnEvent =
  | { type: "token"; text: string }
  | { type: "tool_start"; id: string; toolName: string; arguments: Record<string, unknown> }
  | { type: "tool_end"; id: string; envelope: ToolEnvelope };

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
    middleware: [modelCallLimitMiddleware({ runLimit: MAX_MODEL_CALLS, exitBehavior: "error" })],
  });
  const stream = await agent.stream(
    { messages: opts.messages },
    { streamMode: ["messages", "updates"], signal: opts.signal, callbacks: opts.callbacks },
  );

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
    }
  }
}
