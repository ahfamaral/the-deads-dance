import { afterAll, describe, expect, it } from "vitest";
import { closePool } from "@corpus/db";
import type { ChatStreamEvent, ToolCall } from "@/lib/chat-types";
import { readNdjson } from "@/lib/ndjson";
import { closeMcpClient } from "@/lib/server/mcp-client";
import { loadDevEnv } from "./live-env";

// Opt-in (`npm run test:live`): the real route, MCP server, Wikidata and OpenRouter (spec §4).
loadDevEnv();
const { POST } = await import("@/app/api/chat/route");
afterAll(async () => {
  await closeMcpClient();
  await closePool();
});

async function ask(personaId: string, text: string): Promise<{ text: string; calls: ToolCall[] }> {
  const res = await POST(
    new Request("http://localhost/api/chat", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ personaId, messages: [{ role: "user", text }], acts: [] }),
    }),
  );
  expect(res.status).toBe(200);
  const events: ChatStreamEvent[] = [];
  for await (const e of readNdjson<ChatStreamEvent>(res.body!)) events.push(e);
  const done = events.at(-1);
  if (done?.type !== "done") throw new Error(`Turn failed: ${JSON.stringify(done)}`);
  console.log(`\n[${personaId}] → ${done.message.text}\n`);
  return { text: done.message.text, calls: done.message.toolCalls.filter((c) => c.toolName === "get_historical_context") };
}

describe("get_historical_context (live)", () => {
  it("Einstein looks up 1905 and speaks of what was happening", async () => {
    const { text, calls } = await ask("albert-einstein", "What was happening in the world in 1905?");
    expect(calls.map((c) => c.arguments.year)).toContain(1905);
    const result = calls[0].result as { status: string };
    // A throttled Wikidata is a typed unavailable, not a failed turn; the reply still comes.
    if (result.status === "ok") expect(text).toMatch(/Russia|Tsushima|Portsmouth|Roosevelt|Bloody Sunday|Japan|Franz Joseph|Ruchet/i);
  }, 180_000);
});
