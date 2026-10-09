import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { DynamicStructuredTool } from "@langchain/core/tools";
import { tool } from "langchain";
import { z } from "zod";
import { LOCKED_SCHEMAS, LOCKED_TOOL_NAMES, type ToolEnvelope } from "@/lib/server/persona-tools";
import type { Question, Recording, ToolRecord } from "./types";

/** Spec §29.4: a replayed call with no recorded match and no live tools gets nothing more. */
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
        // The slot is taken before the call, so parallel calls are recorded in the order they were made.
        const slot = into.push({ name: inner.name, args, content: "", envelope: { ok: false, error: "The tool returned no result." } }) - 1;
        const msg = await inner.invoke(
          { type: "tool_call", id: config.toolCall?.id ?? crypto.randomUUID(), name: inner.name, args },
          { signal: config.signal },
        );
        const content = typeof msg.content === "string" ? msg.content : JSON.stringify(msg.content);
        const envelope = (msg.artifact ?? { ok: false, error: "The tool returned no result." }) as ToolEnvelope;
        into[slot] = { name: inner.name, args, content, envelope };
        return asArtifactResult({ content, envelope });
      },
      { name: inner.name, description: inner.description, schema: inner.schema, responseFormat: "content_and_artifact" },
    ) as DynamicStructuredTool,
  );
}

/** Arguments compared for replay: keys sorted, string values trimmed and lower-cased. */
function argsKey(args: Record<string, unknown>): string {
  return JSON.stringify(Object.keys(args).sort().map((k) => [k, typeof args[k] === "string" ? (args[k] as string).trim().toLowerCase() : args[k]]));
}

/**
 * Replay mode: the three locked tools. A call gets the recorded result for the same tool and arguments, whatever
 * the order (serving by call order gave fact-checks other claims' verdicts, found after round 2a). A call nothing
 * matches runs against the live tools when given (counted by onLive), or gets the empty result.
 */
export function replayTools(
  recording: Recording,
  live?: () => Promise<DynamicStructuredTool[] | null>,
  onLive?: () => void,
): DynamicStructuredTool[] {
  const used = new Set<number>();
  let liveTools: Promise<DynamicStructuredTool[] | null> | null = null;
  return LOCKED_TOOL_NAMES.map((name) =>
    tool(
      async (args: Record<string, unknown>, config) => {
        const key = argsKey(args);
        const matches = recording.tools.flatMap((t, i) => (t.name === name && argsKey(t.args) === key ? [i] : []));
        const hit = matches.find((i) => !used.has(i)) ?? matches[0];
        if (hit !== undefined) {
          used.add(hit);
          return asArtifactResult(recording.tools[hit]);
        }
        const inner = live ? (await (liveTools ??= live()))?.find((t) => t.name === name) : undefined;
        if (!inner) return asArtifactResult({ content: EXTRA_CALL_CONTENT, envelope: EXTRA_CALL_RESULT });
        onLive?.();
        const msg = await inner.invoke({ type: "tool_call", id: config.toolCall?.id ?? crypto.randomUUID(), name, args }, { signal: config.signal });
        const content = typeof msg.content === "string" ? msg.content : JSON.stringify(msg.content);
        return asArtifactResult({ content, envelope: (msg.artifact ?? { ok: false, error: "The tool returned no result." }) as ToolEnvelope });
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
