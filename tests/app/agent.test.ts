import { AIMessage, fakeModel, tool } from "langchain";
import { describe, expect, it } from "vitest";
import { z } from "zod";
import { MAX_MODEL_CALLS, runTurn, type TurnEvent } from "@/lib/server/agent";

const envelopeTool = tool(
  async ({ query }: { query: string }) => [
    `found ${query}`,
    { ok: true, data: { status: "ok", passages: [], queries: [query] } },
  ],
  {
    name: "search_biography",
    description: "Search the biography",
    schema: z.object({ query: z.string() }),
    responseFormat: "content_and_artifact",
  },
);

/** An explicit AIMessage: fakeModel().respondWithTools would fill content with the joined inputs. */
const toolCall = (id: string) =>
  new AIMessage({ content: "", tool_calls: [{ id, name: "search_biography", args: { query: "1905" }, type: "tool_call" }] });

async function collect(turn: AsyncIterable<TurnEvent>): Promise<TurnEvent[]> {
  const out: TurnEvent[] = [];
  for await (const e of turn) out.push(e);
  return out;
}

const base = { systemPrompt: "You are Einstein.", messages: [{ role: "user" as const, content: "What happened in 1905?" }] };

describe("runTurn", () => {
  it("streams the tool call, its result and the answer", async () => {
    const model = fakeModel().respond(toolCall("t1")).respond(new AIMessage("In 1905 I wrote four papers."));
    expect(await collect(runTurn({ ...base, model, tools: [envelopeTool] }))).toEqual([
      { type: "tool_start", id: "t1", toolName: "search_biography", arguments: { query: "1905" } },
      { type: "tool_end", id: "t1", envelope: { ok: true, data: { status: "ok", passages: [], queries: ["1905"] } } },
      { type: "token", text: "In 1905 I wrote four papers." },
    ]);
  });

  it("reports a tool result without an envelope as an error", async () => {
    const plain = tool(async () => "just text", {
      name: "search_biography",
      description: "Search the biography",
      schema: z.object({ query: z.string() }),
    });
    const model = fakeModel().respond(toolCall("t1")).respond(new AIMessage("Hmm."));
    const events = await collect(runTurn({ ...base, model, tools: [plain] }));
    expect(events[1]).toEqual({ type: "tool_end", id: "t1", envelope: { ok: false, error: "just text" } });
  });

  it("rethrows model errors", async () => {
    const model = fakeModel().respond(new Error("429 Too Many Requests"));
    await expect(collect(runTurn({ ...base, model, tools: [] }))).rejects.toThrow("429");
  });

  it(`stops after ${MAX_MODEL_CALLS} model calls`, async () => {
    const model = fakeModel();
    for (let i = 0; i <= MAX_MODEL_CALLS; i++) model.respond(toolCall(`t${i}`));
    await expect(collect(runTurn({ ...base, model, tools: [envelopeTool] }))).rejects.toMatchObject({
      name: "ModelCallLimitMiddlewareError",
    });
  });

  it("stops when the signal aborts", async () => {
    const model = fakeModel().respond(new AIMessage("never"));
    await expect(collect(runTurn({ ...base, model, tools: [], signal: AbortSignal.abort() }))).rejects.toMatchObject({
      name: "AbortError",
    });
  });
});
