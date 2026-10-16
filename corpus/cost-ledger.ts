import { BaseCallbackHandler } from "@langchain/core/callbacks/base";
import type { EmbeddingsInterface } from "@langchain/core/embeddings";
import type { LLMResult } from "@langchain/core/outputs";
import { z } from "zod";

/**
 * Spec §26.3: every model call a turn (or an ingest) makes, with its real cost. Shared by the app
 * and the MCP child, so no "@/" imports. One ledger per turn or tool call, never a shared one.
 */
export const MODEL_CALL_ROLES = ["agent", "classifier", "helper", "recall", "embedding", "ingest", "tts"] as const;
export type ModelCallRole = (typeof MODEL_CALL_ROLES)[number];

export const ModelCallSchema = z.object({
  role: z.enum(MODEL_CALL_ROLES),
  model: z.string().min(1).max(200),
  inputTokens: z.number().int().min(0),
  outputTokens: z.number().int().min(0),
  /** Micro-dollars from OpenRouter's usage.cost; null when the response had none. */
  cost: z.number().int().min(0).nullable(),
  generationId: z.string().max(200).nullable(),
  latencyMs: z.number().int().min(0).nullable(),
});
export type ModelCallRecord = z.infer<typeof ModelCallSchema>;

export const dollarsToMicros = (dollars: number) => Math.round(dollars * 1_000_000);

/** About four characters a token. Only for embeddings, whose usage LangChain drops. */
export const estimateTokens = (text: string) => Math.ceil(text.length / 4);

/** Calls from the MCP child are untrusted input: each malformed entry is dropped. */
export function parseCalls(value: unknown): ModelCallRecord[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((v) => {
    const parsed = ModelCallSchema.safeParse(v);
    return parsed.success ? [parsed.data] : [];
  });
}

type Billed = {
  id?: unknown;
  response_metadata?: { usage?: { cost?: unknown; prompt_tokens?: unknown } };
  usage_metadata?: { input_tokens?: number; output_tokens?: number };
};

/**
 * Task 0 finding: on streamed calls LangChain's chunk merge sums numbers, so every number in
 * response_metadata.usage (cost included) is a multiple k of the real one. usage_metadata is correct,
 * so k is read off the prompt tokens (68 vs 34 measured: k = 2) and the cost divided by it.
 */
function billedDollars(message: Billed | undefined): number | null {
  const usage = message?.response_metadata?.usage;
  const cost = usage?.cost;
  if (typeof cost !== "number" || !Number.isFinite(cost) || cost < 0) return null;
  const input = message?.usage_metadata?.input_tokens;
  const prompt = usage?.prompt_tokens;
  if (typeof prompt === "number" && typeof input === "number" && input > 0) {
    const k = Math.round(prompt / input);
    if (k >= 2) return cost / k;
  }
  return cost;
}

class LedgerHandler extends BaseCallbackHandler {
  name = "cost-ledger";
  private readonly started = new Map<string, { at: number; model: string }>();

  constructor(
    private readonly ledger: CostLedger,
    private readonly role: ModelCallRole,
  ) {
    // Awaited, so a call is on the ledger before invoke() returns: the MCP tool reads it right after.
    super({ _awaitHandler: true });
  }

  async handleChatModelStart(
    _llm: unknown,
    _messages: unknown,
    runId: string,
    _parentRunId?: string,
    extraParams?: Record<string, unknown>,
    _tags?: string[],
    metadata?: Record<string, unknown>,
  ) {
    const params = extraParams?.invocation_params as { model?: unknown } | undefined;
    const named = typeof metadata?.ls_model_name === "string" ? metadata.ls_model_name : undefined;
    const model = named || (typeof params?.model === "string" ? params.model : "") || "unknown";
    this.started.set(runId, { at: Date.now(), model });
  }

  async handleLLMEnd(output: LLMResult, runId: string) {
    const start = this.started.get(runId);
    this.started.delete(runId);
    const message = (output.generations[0]?.[0] as { message?: Billed } | undefined)?.message;
    const dollars = billedDollars(message);
    this.ledger.record({
      role: this.role,
      model: start?.model ?? "unknown",
      inputTokens: message?.usage_metadata?.input_tokens ?? 0,
      outputTokens: message?.usage_metadata?.output_tokens ?? 0,
      cost: dollars === null ? null : dollarsToMicros(dollars),
      generationId: typeof message?.id === "string" ? message.id : null,
      latencyMs: start ? Date.now() - start.at : null,
    });
  }

  async handleLLMError(_err: unknown, runId: string) {
    this.started.delete(runId); // a failed call isn't billed
  }
}

export class CostLedger {
  readonly calls: ModelCallRecord[] = [];

  /** A callback handler that records calls under this role. Pass it in a run's config, or to chatModel. */
  handler(role: ModelCallRole): BaseCallbackHandler {
    return new LedgerHandler(this, role);
  }

  record(call: ModelCallRecord): void {
    this.calls.push(call);
  }

  add(calls: readonly ModelCallRecord[]): void {
    this.calls.push(...calls);
  }
}

/** Embeddings have no LangChain callbacks: this wrapper records each call, tokens estimated, cost left to the app. */
export function meteredEmbeddings(inner: EmbeddingsInterface, ledger: CostLedger, model: string): EmbeddingsInterface {
  const note = (texts: string[], startedAt: number) =>
    ledger.record({
      role: "embedding",
      model,
      inputTokens: texts.reduce((n, t) => n + estimateTokens(t), 0),
      outputTokens: 0,
      cost: null,
      generationId: null,
      latencyMs: Date.now() - startedAt,
    });
  return {
    async embedDocuments(texts) {
      const startedAt = Date.now();
      const vectors = await inner.embedDocuments(texts);
      note(texts, startedAt);
      return vectors;
    },
    async embedQuery(text) {
      const startedAt = Date.now();
      const vector = await inner.embedQuery(text);
      note([text], startedAt);
      return vector;
    },
  };
}
