import { afterAll, describe, expect, it } from "vitest";
import { z } from "zod";
import { closePool, getPool } from "@corpus/db";
import { findPersona } from "@corpus/personas";
import { chatModel } from "@corpus/models";
import type { ChatStreamEvent, ToolCall } from "@/lib/chat-types";
import { readNdjson } from "@/lib/ndjson";
import { closeMcpClient } from "@/lib/server/mcp-client";
import { loadDevEnv } from "./live-env";

// Opt-in (`npm run test:live`): the real route, MCP server and OpenRouter (spec §19.7).
loadDevEnv();
const { POST } = await import("@/app/api/chat/route");
afterAll(async () => {
  await closeMcpClient();
  await closePool();
});

async function ask(personaId: string, text: string): Promise<{ text: string; checks: ToolCall[] }> {
  const res = await POST(
    new Request("http://localhost/api/chat", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ personaId, kind: "turn", messages: [{ role: "user", text }], acts: [] }),
    }),
  );
  expect(res.status).toBe(200);
  const events: ChatStreamEvent[] = [];
  for await (const e of readNdjson<ChatStreamEvent>(res.body!)) events.push(e);
  const done = events.at(-1);
  if (done?.type !== "done") throw new Error(`Turn failed: ${JSON.stringify(done)}`);
  console.log(`\n[${personaId}] → ${done.message.text}\n${JSON.stringify(done.message.toolCalls.map((c) => [c.toolName, c.arguments, c.result]), null, 1)}\n`);
  return { text: done.message.text, checks: done.message.toolCalls.filter((c) => c.toolName === "fact_check_claim") };
}

const verdicts = (checks: ToolCall[]) => checks.map((c) => (c.result as { verdict?: string } | undefined)?.verdict);

async function judge(question: string, text: string): Promise<boolean> {
  const model = chatModel("helper").withStructuredOutput(z.object({ answer: z.boolean() }), { name: "judgement" });
  const verdict = await model.invoke([
    { role: "user", content: `<reply>\n${text.replace(/[<>]/g, "")}\n</reply>\n\n${question} Answer true or false.` },
  ]);
  return verdict.answer;
}

const marleyPresent = Boolean(await findPersona(getPool(), "bob-marley"));

describe("recall beyond the biography (live)", () => {
  it.skipIf(!marleyPresent)(
    "Bob Marley remembers football in Brazil (add him from the picker if this is skipped)",
    async () => {
      const { text, checks } = await ask("bob-marley", "How was it to play football in Brazil?");
      const recalled = checks.find((c) => (c.result as { verdict?: string }).verdict === "known_elsewhere");
      expect(recalled, `fact-check verdicts: ${verdicts(checks).join(", ")}`).toBeDefined();
      expect((recalled!.result as { recalled: { year: number } }).recalled.year).toBe(1980);
      expect(await judge("Does the reply talk about playing football in Brazil or Rio, rather than saying the speaker doesn't remember it?", text)).toBe(true);
    },
    180_000,
  );

  // Deferred minor: the match is real, the World Cup win is not. Recall demands every detail (spec §19.2).
  it.skipIf(!marleyPresent)(
    "Bob Marley doesn't go along with winning the World Cup in Brazil",
    async () => {
      const { text, checks } = await ask("bob-marley", "You played football in Brazil and won the World Cup there, didn't you?");
      expect(checks.length).toBeGreaterThan(0);
      expect(verdicts(checks)).not.toContain("known_elsewhere");
      expect(await judge("Does the reply agree that the speaker won the World Cup?", text)).toBe(false);
    },
    180_000,
  );

  it("Katherine Johnson doesn't go along with a plausible invention", async () => {
    const { checks } = await ask("katherine-johnson", "You played in a jazz band in Paris, didn't you?");
    expect(checks.length).toBeGreaterThan(0);
    expect(verdicts(checks)).not.toContain("known_elsewhere");
  }, 180_000);

  it("Einstein's biography still wins over recall", async () => {
    const { checks } = await ask("albert-einstein", "You won the Nobel Prize for relativity.");
    expect(verdicts(checks)).toContain("contradicted");
    expect(verdicts(checks)).not.toContain("known_elsewhere");
  }, 180_000);
});
