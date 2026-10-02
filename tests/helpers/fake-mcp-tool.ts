import type { DynamicStructuredTool } from "@langchain/core/tools";
import { tool } from "langchain";
import { z } from "zod";

/**
 * Stands in for a tool from @langchain/mcp-adapters: responseFormat content_and_artifact,
 * with the MCP structuredContent in the artifact as { type: "mcp_structured_content", data }.
 * `respond` may throw, like an MCP isError result or a dead child process.
 */
export function fakeMcpTool(name: string, respond: (args: Record<string, unknown>) => unknown) {
  const calls: Record<string, unknown>[] = [];
  const mcpTool = tool(
    async (args: Record<string, unknown>) => {
      calls.push(args);
      const data = respond(args);
      return [JSON.stringify({ type: "text", text: JSON.stringify(data) }), [{ type: "mcp_structured_content", data }]];
    },
    { name, description: `${name} (fake)`, schema: z.looseObject({}), responseFormat: "content_and_artifact" },
  ) as unknown as DynamicStructuredTool;
  return { tool: mcpTool, calls };
}
