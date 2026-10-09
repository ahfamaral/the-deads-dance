import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { tool } from "langchain";
import { describe, expect, it } from "vitest";
import { z } from "zod";
import { EXTRA_CALL_RESULT, questionKey, readRecording, recordingTools, replayTools, writeRecording } from "../../eval/lookups";
import type { Recording, ToolRecord } from "../../eval/types";

const call = (t: { invoke: (x: unknown) => Promise<unknown> }, name: string, args: Record<string, unknown>, id = "c1") =>
  t.invoke({ type: "tool_call", id, name, args }) as Promise<{ content: string; artifact: unknown }>;

const recording: Recording = {
  questionId: "q1",
  question: "Where were you born?",
  act: null,
  tools: [
    { name: "search_biography", args: { query: "Ulm" }, content: '{"passages":[]}', envelope: { ok: true, data: { passages: [] } } },
    { name: "fact_check_claim", args: { claim: "x" }, content: "Tool failed: timeout", envelope: { ok: false, error: "timeout" } },
    { name: "search_biography", args: { query: "Bern" }, content: '{"passages":[1]}', envelope: { ok: true, data: { passages: [1] } } },
  ],
};

describe("replayTools (replay by arguments, after round 2a's mismatched fact-checks)", () => {
  const liveSearch = (seen: string[]) => tool(async ({ query }: { query: string }) => { seen.push(query); return [`live ${query}`, { ok: true, data: { live: query } }]; }, {
    name: "search_biography", description: "d", schema: z.object({ query: z.string() }), responseFormat: "content_and_artifact",
  });

  it("serves the recorded result whose arguments match, whatever the order of the calls", async () => {
    const tools = replayTools(recording);
    const search = tools.find((t) => t.name === "search_biography")!;
    expect((await call(search, "search_biography", { query: "Bern" })).artifact).toEqual({ ok: true, data: { passages: [1] } });
    expect((await call(search, "search_biography", { query: "Ulm" }, "c2")).artifact).toEqual({ ok: true, data: { passages: [] } });
  });

  it("matches arguments ignoring case and surrounding spaces", async () => {
    const search = replayTools(recording).find((t) => t.name === "search_biography")!;
    expect((await call(search, "search_biography", { query: "  ulm " })).artifact).toEqual({ ok: true, data: { passages: [] } });
  });

  it("serves the same recorded result again for a repeated identical call", async () => {
    const search = replayTools(recording).find((t) => t.name === "search_biography")!;
    await call(search, "search_biography", { query: "Ulm" });
    expect((await call(search, "search_biography", { query: "Ulm" }, "c2")).artifact).toEqual({ ok: true, data: { passages: [] } });
  });

  it("runs a call nothing in the recording matches against the live tool, and counts it", async () => {
    const seen: string[] = [];
    let liveCalls = 0;
    const search = replayTools(recording, async () => [liveSearch(seen) as never], () => liveCalls++).find((t) => t.name === "search_biography")!;
    expect((await call(search, "search_biography", { query: "Zurich" })).artifact).toEqual({ ok: true, data: { live: "Zurich" } });
    expect(seen).toEqual(["Zurich"]);
    expect(liveCalls).toBe(1);
  });

  it("without live tools, an unmatched call gets the empty result, never a crash", async () => {
    const tools = replayTools(recording);
    expect((await call(tools.find((t) => t.name === "search_biography")!, "search_biography", { query: "c" })).artifact).toEqual(EXTRA_CALL_RESULT);
    expect((await call(tools.find((t) => t.name === "get_historical_context")!, "get_historical_context", { year: 1905 })).artifact).toEqual(EXTRA_CALL_RESULT);
  });

  it("offers exactly the three locked tools", () => {
    expect(replayTools(recording).map((t) => t.name).sort()).toEqual(["fact_check_claim", "get_historical_context", "search_biography"]);
  });
});

describe("recordingTools", () => {
  it("passes calls through to the live tool and records name, args, content and envelope", async () => {
    const live = tool(async ({ query }: { query: string }) => [`found ${query}`, { ok: true, data: { query } }], {
      name: "search_biography", description: "d", schema: z.object({ query: z.string() }), responseFormat: "content_and_artifact",
    });
    const into: ToolRecord[] = [];
    const [wrapped] = recordingTools([live], into);
    const result = await call(wrapped, "search_biography", { query: "Ulm" });
    expect(result.artifact).toEqual({ ok: true, data: { query: "Ulm" } });
    expect(into).toEqual([{ name: "search_biography", args: { query: "Ulm" }, content: "found Ulm", envelope: { ok: true, data: { query: "Ulm" } } }]);
  });

  it("records calls in the order they were made, even when a later call finishes first", async () => {
    const live = tool(async ({ query }: { query: string }) => {
      await new Promise((r) => setTimeout(r, query === "slow" ? 30 : 0));
      return [query, { ok: true, data: { query } }];
    }, { name: "search_biography", description: "d", schema: z.object({ query: z.string() }), responseFormat: "content_and_artifact" });
    const into: ToolRecord[] = [];
    const [wrapped] = recordingTools([live], into);
    await Promise.all([call(wrapped, "search_biography", { query: "slow" }), call(wrapped, "search_biography", { query: "fast" }, "c2")]);
    expect(into.map((r) => r.args.query)).toEqual(["slow", "fast"]);
  });
});

describe("questionKey", () => {
  it("changes when the question's text or history changes", () => {
    const q = { id: "q", persona: "p", category: "ordinary" as const, text: "Where?", expect: "e", screening: false };
    expect(questionKey(q)).toBe(questionKey({ ...q, expect: "other" }));
    expect(questionKey(q)).not.toBe(questionKey({ ...q, text: "Where now?" }));
    expect(questionKey(q)).not.toBe(questionKey({ ...q, history: [{ role: "user", text: "Hi" }] }));
  });
});

describe("recording files", () => {
  it("round-trip, and read null when missing", () => {
    const dir = mkdtempSync(join(tmpdir(), "eval-lookups-"));
    expect(readRecording(dir, "q1")).toBeNull();
    writeRecording(dir, recording);
    expect(readRecording(dir, "q1")).toEqual(recording);
  });
  it("treat a truncated or malformed recording as missing, so the question runs live again", () => {
    const dir = mkdtempSync(join(tmpdir(), "eval-lookups-"));
    writeFileSync(join(dir, "q1.json"), '{"questionId":"q1","act":null,"tools":[');
    expect(readRecording(dir, "q1")).toBeNull();
    writeFileSync(join(dir, "q1.json"), JSON.stringify({ questionId: "q1", tools: "nope" }));
    expect(readRecording(dir, "q1")).toBeNull();
  });
});

describe("replayed tool descriptions", () => {
  it("match the live MCP tools word for word, so the persona model sees the same tools", async () => {
    const { readFileSync } = await import("node:fs");
    const server = readFileSync("mcp-server/server.ts", "utf8").replace(/"\s*\+\s*"/g, "");
    for (const t of replayTools(recording)) expect(server).toContain(JSON.stringify(t.description));
  });
});
