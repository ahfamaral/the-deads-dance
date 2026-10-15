import type { DynamicStructuredTool } from "@langchain/core/tools";
import { loadMcpTools } from "@langchain/mcp-adapters";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { liveDepsFor } from "../../../mcp-server/deps";
import { createServer, type DepsFor } from "../../../mcp-server/server";

/** Each tool call's limit (spec §9). */
export const TOOL_TIMEOUT_MS = 30_000;

export type McpConnection = { tools: DynamicStructuredTool[]; close: () => Promise<void> };

/**
 * Spec §31.4: the MCP server runs in this process, linked to a real MCP client in memory.
 * Same protocol, tools and results as over stdio; no child process, so it runs on serverless.
 */
export async function connectInMemory(depsFor: DepsFor): Promise<McpConnection> {
  const [serverSide, clientSide] = InMemoryTransport.createLinkedPair();
  const server = createServer(depsFor);
  const client = new Client({ name: "persona-app", version: "0.1.0" });
  const close = async () => {
    await client.close().catch(() => {});
    await server.close().catch(() => {});
  };
  try {
    await server.connect(serverSide);
    await client.connect(clientSide);
    const tools = await loadMcpTools("biography", client, { throwOnLoadError: true, defaultToolTimeout: TOOL_TIMEOUT_MS });
    return { tools, close };
  } catch (err) {
    await close();
    throw err;
  }
}

// Kept on globalThis so Next.js dev reloads reuse one server. A promise, so concurrent first
// requests on a cold instance share one connection.
const holder = globalThis as unknown as { personaMcp?: Promise<McpConnection> };

/**
 * The biography tools, or null when the MCP server can't be started. The app still runs
 * then, with a banner (spec §9); the next call tries again.
 */
export async function getMcpTools(): Promise<DynamicStructuredTool[] | null> {
  // .then() so a synchronous throw in liveDepsFor() becomes a rejection handled below.
  const pending = (holder.personaMcp ??= Promise.resolve().then(() => connectInMemory(liveDepsFor())));
  try {
    return (await pending).tools;
  } catch (err) {
    console.error("MCP server unavailable:", err);
    if (holder.personaMcp === pending) holder.personaMcp = undefined;
    return null;
  }
}

/** For tests and scripts: close the in-process server. */
export async function closeMcpClient(): Promise<void> {
  const pending = holder.personaMcp;
  holder.personaMcp = undefined;
  const connection = await pending?.catch(() => undefined);
  await connection?.close();
}
