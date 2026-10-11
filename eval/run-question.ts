import type { DynamicStructuredTool } from "@langchain/core/tools";
import { CostLedger, type ModelCallRecord } from "@corpus/cost-ledger";
import type { PersonaRow } from "@corpus/personas";
import type { HistoryMessage } from "@/lib/chat-types";
import { runTurn, type TurnEvent } from "@/lib/server/agent";
import { toAgentMessages } from "@/lib/server/chat-request";
import { chatEvents } from "@/lib/server/chat-stream";
import { renderConversationState } from "@/lib/server/conversation-state";
import { lockPersona } from "@/lib/server/persona-tools";
import type { ClassifyVisitor } from "@/lib/server/visitor-classifier";
import { foldVisit } from "@/lib/visit";
import { DEFAULT_COSTS } from "./budget";
import { questionKey, recordingTools, replayTools } from "./lookups";
import type { Setup } from "./setups";
import type { Question } from "./questions";
import type { AnswerRecord, Recording, ToolRecord } from "./types";

export type QuestionDeps = {
  classify: ClassifyVisitor;
  liveTools: () => Promise<DynamicStructuredTool[] | null>;
  recordingFor: (questionId: string) => Recording | null;
  resolveCosts: (calls: readonly ModelCallRecord[]) => Promise<{ cost: number; inputTokens: number; outputTokens: number }[]>;
  now?: () => number;
};

const MCP_DOWN = "The MCP server is unavailable.";

/** Prices the calls; if pricing itself fails, counts each unpriced call at the default live-answer cost (an overcount, never a loss). */
async function priceCalls(deps: QuestionDeps, calls: readonly ModelCallRecord[]): Promise<{ cost: number; inputTokens: number; outputTokens: number }[]> {
  try {
    return await deps.resolveCosts(calls);
  } catch {
    return calls.map((c) => ({ cost: c.cost ?? DEFAULT_COSTS.liveAnswer, inputTokens: c.inputTokens, outputTokens: c.outputTokens }));
  }
}

/** A lookup failed when the call threw or the tool answered "unavailable" (spec §9's typed failure). */
const lookupWorked = (t: ToolRecord) => t.envelope.ok && (t.envelope.data as { status?: string } | undefined)?.status !== "unavailable";

/** Notes a truncated event on its way to chatEvents, which swallows it (spec §28.2), and the raw reply before the guards (§30.7). */
async function* watchTruncation(turn: AsyncIterable<TurnEvent>, seen: { truncated: boolean; raw: string }): AsyncGenerator<TurnEvent> {
  for await (const e of turn) {
    if (e.type === "truncated") seen.truncated = true;
    if (e.type === "token") seen.raw += e.text;
    yield e;
  }
}

/** chatEvents adds a blank line between model steps, even where the raw reply had no space (final review #3). */
const collapse = (s: string) => s.replace(/\s+/g, "");

/**
 * Spec §29.4: one visitor turn through the app's own pipeline. Live without a recording (the
 * result carries a new recording); replayed otherwise. Never throws for a failed turn.
 */
export async function runQuestion(
  deps: QuestionDeps,
  q: Question,
  setup: Setup,
  persona: PersonaRow,
): Promise<{ answer: AnswerRecord; recording: Recording | null }> {
  const now = deps.now ?? Date.now;
  const started = now();
  const ledger = new CostLedger();
  const found = setup.lookups === "replay" ? deps.recordingFor(q.id) : null;
  const saved = found?.question === questionKey(q) ? found : null; // an edited question runs live again
  const history: HistoryMessage[] = [...(q.history ?? []), { role: "user", text: q.text }];
  const previous = q.history?.at(-1);

  let act: Recording["act"] = null;
  let liveLookups = 0;
  const recorded: ToolRecord[] = [];
  const seen = { truncated: false, raw: "" };
  let text: string | null = null;
  let error: string | null = null;
  let toolCalls: AnswerRecord["toolCalls"] = [];
  let firstWordMs: number | null = null;
  try {
    let tools: DynamicStructuredTool[];
    if (saved) {
      act = saved.act;
      // A call the recording doesn't hold runs live, on this question's ledger (found after round 2a).
      tools = replayTools(saved, async () => {
        const live = await deps.liveTools();
        return live && lockPersona(live, persona.slug, ledger);
      }, () => liveLookups++);
    } else {
      const [live, classified] = await Promise.all([
        deps.liveTools(),
        deps.classify({
          personaMessage: previous?.role === "persona" ? previous.text : null,
          visitorMessage: q.text,
          profile: persona.profile,
          callbacks: [ledger.handler("classifier")],
        }),
      ]);
      // Production answers with its tools; a tool-less turn would measure something else.
      if (!live) throw new Error(MCP_DOWN);
      act = classified;
      tools = recordingTools(lockPersona(live, persona.slug, ledger), recorded);
    }

    // One null act for every earlier visitor message in the question's history, then this question's act.
    const earlierActs = (q.history ?? []).filter((m) => m.role === "user").map(() => null);
    const visit = foldVisit([...earlierActs, act]);
    const state = renderConversationState({ visit, languages: persona.languages, languageMode: setup.languageMode });
    for await (const event of chatEvents({
      personaId: persona.slug,
      ended: visit.ended ?? null,
      turn: watchTruncation(
        runTurn({
          model: setup.agentModel(),
          tools,
          systemPrompt: setup.buildPrompt(persona, { toolsAvailable: tools.length > 0, state }),
          messages: toAgentMessages(history),
          callbacks: [ledger.handler("agent")],
        }),
        seen,
      ),
    })) {
      if (event.type === "token" && firstWordMs === null && /\S/.test(event.text)) {
        firstWordMs = now() - started;
      } else if (event.type === "done") {
        text = event.message.text;
        toolCalls = event.message.toolCalls;
      } else if (event.type === "error") {
        error = event.reason;
      }
    }
  } catch (err) {
    // Spec §29.8: a failed question is recorded as an error; the money it spent is still counted below.
    error = err instanceof Error ? err.message : String(err);
  }

  // Spec §30.7: chatEvents applies the app's guards; the raw reply is kept when they changed it ("Guards fired").
  // Whitespace is ignored (chatEvents adds a blank line between model steps); a truncated reply is trimmed, not guarded.
  const rawText = text !== null && !error && !seen.truncated && collapse(seen.raw) !== collapse(text) ? seen.raw : undefined;

  const priced = await priceCalls(deps, ledger.calls);
  const answer: AnswerRecord = {
    questionId: q.id,
    setupId: setup.id,
    persona: persona.slug,
    category: q.category,
    text: error ? null : text,
    ...(rawText === undefined ? {} : { rawText }),
    ...(saved ? { liveLookups } : {}),
    error,
    truncated: seen.truncated,
    toolCalls,
    lookups: saved ? "replay" : "live",
    durationMs: now() - started,
    firstWordMs,
    answerMicros: priced.reduce((s, c) => s + c.cost, 0),
    inputTokens: priced.reduce((s, c) => s + c.inputTokens, 0),
    outputTokens: priced.reduce((s, c) => s + c.outputTokens, 0),
  };
  // A failed turn or a failed lookup is never recorded: every later replay would inherit the failure.
  // A live setup (another model) never records: its searches would replay for v0 (spec §30.6).
  const clean = setup.lookups === "replay" && !saved && !error && recorded.every(lookupWorked);
  return { answer, recording: clean ? { questionId: q.id, question: questionKey(q), act, tools: recorded } : null };
}
