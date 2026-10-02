import path from "node:path";
import type { DynamicStructuredTool } from "@langchain/core/tools";
import { MultiServerMCPClient } from "@langchain/mcp-adapters";

// Kept on globalThis so Next.js dev reloads reuse one child process instead of spawning one per reload.
const holder = globalThis as unknown as { personaMcp?: MultiServerMCPClient };

/** The stdio child gets only a safe default env (PATH, HOME…), not ours: pass what it needs. */
function childEnv(): Record<string, string> {
  const env: Record<string, string> = {};
  for (const key of ["DATABASE_URL", "OPENROUTER_API_KEY", "HELPER_MODEL", "RECALL_MODEL"]) {
    const value = process.env[key];
    if (value) env[key] = value;
  }
  return env;
}

function createClient(): MultiServerMCPClient {
  const root = process.cwd();
  return new MultiServerMCPClient({
    mcpServers: {
      biography: {
        transport: "stdio",
        command: path.join(root, "node_modules", ".bin", "tsx"),
        args: [path.join(root, "mcp-server", "index.ts")],
        env: childEnv(),
        stderr: "inherit",
        // A crashed child is respawned; getTools() afterwards returns connected tools.
        restart: { enabled: true, maxAttempts: 3, delayMs: 500 },
      },
    },
    defaultToolTimeout: 30_000,
  });
}

/**
 * The biography tools, or null when the MCP server can't be started. The app still runs
 * then, with a banner (spec §9). Tools are fetched on every call, because tools obtained
 * before a child restart stay disconnected.
 */
export async function getMcpTools(): Promise<DynamicStructuredTool[] | null> {
  holder.personaMcp ??= createClient();
  const client = holder.personaMcp;
  try {
    return await client.getTools();
  } catch (err) {
    console.error("MCP server unavailable:", err);
    if (holder.personaMcp === client) holder.personaMcp = undefined; // the next request starts afresh
    await client.close().catch(() => {});
    return null;
  }
}

/** For tests and scripts: stop the child process. */
export async function closeMcpClient(): Promise<void> {
  const client = holder.personaMcp;
  holder.personaMcp = undefined;
  await client?.close();
}
