import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { DynamicStructuredTool } from "@langchain/core/tools";
import { tool } from "langchain";
import { z } from "zod";
import { LOCKED_SCHEMAS, LOCKED_TOOL_NAMES, type ToolEnvelope } from "@/lib/server/persona-tools";
import type { Question, Recording, ToolRecord } from "./types";

/** Spec §29.4: a replayed setup that calls a tool more often than the recording gets nothing more. */
export const EXTRA_CALL_RESULT: ToolEnvelope = { ok: false, error: "No more results." };
const EXTRA_CALL_CONTENT = "Tool failed: No more results.";

/** The live MCP descriptions (mcp-server/server.ts), copied so a replay offers the model the same tools; a test pins them. */
const DESCRIPTIONS: Record<string, string> = {
  search_biography:
    "Search the persona's biography for passages relevant to a question. Returns passages with their section headings. Use it before stating any fact about the persona's life.",
  fact_check_claim:
    "Check a claim the user made about the persona's life against the biography. Returns supported, contradicted or not_mentioned, with the passage it judged from, or known_elsewhere when the biography doesn't cover the claim but it is widely recorded elsewhere, with what happened in recalled. Use it before agreeing with a user's claim about the persona's life.",
  get_historical_context:
    "What was happening in the world in one year of the persona's life: notable events dated that year, and who held the top offices in the persona's countries. From Wikidata. Returns empty for a year after the persona's death. Use it when the visitor asks what the world was like in a year, or to place a memory in its time.",
};

const asArtifactResult = (r: Pick<ToolRecord, "content" | "envelope">): [string, ToolEnvelope] => [r.content, r.envelope];

/** Wraps live locked tools so each call is appended to `into` (spec §29.4, live mode). */
export function recordingTools(live: DynamicStructuredTool[], into: ToolRecord[]): DynamicStructuredTool[] {
  return live.map((inner) =>
    tool(
      async (args: Record<string, unknown>, config) => {
        const msg = await inner.invoke(
          { type: "tool_call", id: config.toolCall?.id ?? crypto.randomUUID(), name: inner.name, args },
          { signal: config.signal },
        );
        const content = typeof msg.content === "string" ? msg.content : JSON.stringify(msg.content);
        const envelope = (msg.artifact ?? { ok: false, error: "The tool returned no result." }) as ToolEnvelope;
        into.push({ name: inner.name, args, content, envelope });
        return asArtifactResult({ content, envelope });
      },
      { name: inner.name, description: inner.description, schema: inner.schema, responseFormat: "content_and_artifact" },
    ) as DynamicStructuredTool,
  );
}

/** Spec §29.4, replay mode: the three locked tools, serving the recording by tool name and call order. */
export function replayTools(recording: Recording): DynamicStructuredTool[] {
  const served = new Map<string, number>();
  return LOCKED_TOOL_NAMES.map((name) =>
    tool(
      async () => {
        const nth = served.get(name) ?? 0;
        served.set(name, nth + 1);
        const hit = recording.tools.filter((t) => t.name === name)[nth];
        return asArtifactResult(hit ?? { content: EXTRA_CALL_CONTENT, envelope: EXTRA_CALL_RESULT });
      },
      { name, description: DESCRIPTIONS[name], schema: LOCKED_SCHEMAS[name], responseFormat: "content_and_artifact" },
    ) as DynamicStructuredTool,
  );
}

/** What a recording was made for: the question's text and earlier turns (not its `expect`, which lookups don't see). */
export function questionKey(q: Question): string {
  return JSON.stringify([q.text, q.history ?? []]);
}

const RecordingSchema = z.object({
  questionId: z.string(),
  question: z.string(),
  act: z.unknown(),
  tools: z.array(z.object({ name: z.string(), args: z.record(z.string(), z.unknown()), content: z.string(), envelope: z.looseObject({ ok: z.boolean() }) })),
});

/** A truncated or malformed recording (say, a run killed mid-write) counts as missing: the question runs live again. */
export function readRecording(dir: string, questionId: string): Recording | null {
  const path = join(dir, `${questionId}.json`);
  if (!existsSync(path)) return null;
  try {
    const raw: unknown = JSON.parse(readFileSync(path, "utf8"));
    return RecordingSchema.safeParse(raw).success ? (raw as Recording) : null;
  } catch {
    return null;
  }
}

export function writeRecording(dir: string, recording: Recording): void {
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, `${recording.questionId}.json`), `${JSON.stringify(recording, null, 2)}\n`);
}
