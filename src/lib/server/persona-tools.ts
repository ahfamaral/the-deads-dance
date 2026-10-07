import type { DynamicStructuredTool } from "@langchain/core/tools";
import { parseCalls, type CostLedger } from "@corpus/cost-ledger";
import { tool } from "langchain";
import { z } from "zod";

/** Every locked tool's artifact, success or not. Payloads (e.g. a verdict) needn't carry a status of their own. */
export type ToolEnvelope = { ok: true; data: unknown } | { ok: false; error: string };

/** What the model sees. persona_id is deliberately absent: the route injects it (spec §16.2). */
const LOCKED_SCHEMAS = {
  search_biography: z.object({
    // F9: matches the server's own bound (mcp-server/server.ts) so the model sees the real limit.
    query: z.string().max(1000).describe("What to look up, in plain words"),
    top_k: z.number().int().min(1).max(10).optional().describe("How many passages to return; default 3"),
  }),
  fact_check_claim: z.object({
    claim: z.string().max(1000).describe("The user's claim about your life, restated as one sentence"),
  }),
  // Matches the server's own bounds (mcp-server/server.ts).
  get_historical_context: z.object({
    year: z.number().int().min(1).max(2100).describe("The year, e.g. 1905"),
  }),
};

type LockedToolName = keyof typeof LOCKED_SCHEMAS;
export const LOCKED_TOOL_NAMES = Object.keys(LOCKED_SCHEMAS) as LockedToolName[];

// Typed z.ZodObject, not z.ZodTypeAny: otherwise tool() returns DynamicTool | DynamicStructuredTool.
function lock(inner: DynamicStructuredTool, schema: z.ZodObject, personaId: string, ledger?: CostLedger) {
  return tool(
    async (args: Record<string, unknown>, config) => {
      // MCP validates with JSON Schema and rejects keys set to undefined. The injected persona_id always wins.
      const clean = Object.fromEntries(Object.entries(args).filter(([, v]) => v !== undefined));
      let envelope: ToolEnvelope;
      try {
        // Invoked with a ToolCall so the ToolMessage keeps its artifact (plain args return content only).
        // Forward the signal explicitly (F5) so an aborted call is cancelled; the route no longer
        // aborts turns (spec §26.4). This doesn't rely on LangChain's ambient (AsyncLocalStorage) config propagation, which is
        // internal behaviour, not a documented contract.
        const msg = await inner.invoke(
          {
            type: "tool_call",
            id: config.toolCall?.id ?? crypto.randomUUID(),
            name: inner.name,
            args: { ...clean, persona_id: personaId },
          },
          { signal: config.signal },
        );
        const artifacts = (msg.artifact ?? []) as { type: string; data?: unknown }[];
        const structured = artifacts.find((a) => a.type === "mcp_structured_content");
        if (structured) {
          // Spec §26.3: the tool's model costs ride along; they go to the ledger, never to the agent.
          const { calls, ...data } = (structured.data ?? {}) as Record<string, unknown>;
          ledger?.add(parseCalls(calls));
          envelope = { ok: true, data };
        } else {
          envelope = { ok: false, error: "The tool returned no result." };
        }
      } catch (err) {
        // MCP isError results and a dead child process both throw here.
        envelope = { ok: false, error: err instanceof Error ? err.message : String(err) };
      }
      // [what the model reads, artifact for the app]
      return [envelope.ok ? JSON.stringify(envelope.data) : `Tool failed: ${envelope.error}`, envelope];
    },
    { name: inner.name, description: inner.description, schema, responseFormat: "content_and_artifact" },
  );
}

/** Wraps the allowlisted MCP tools for one persona. Anything else the server offers is dropped. */
export function lockPersona(tools: DynamicStructuredTool[], personaId: string, ledger?: CostLedger) {
  return LOCKED_TOOL_NAMES.flatMap((name) => {
    const inner = tools.find((t) => t.name === name);
    return inner ? [lock(inner, LOCKED_SCHEMAS[name], personaId, ledger)] : [];
  });
}
