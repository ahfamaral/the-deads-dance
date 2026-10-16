import { describe, expect, it, vi } from "vitest";
import type { ModelCallRecord } from "@corpus/cost-ledger";
import { pricingWith } from "@/lib/server/pricing";
import { TTS_MODEL } from "@/lib/server/tts";

const call = (extra: Partial<ModelCallRecord> = {}): ModelCallRecord => ({
  role: "helper", model: "openai/gpt-5-mini", inputTokens: 1_000, outputTokens: 100, cost: null, generationId: null, latencyMs: 5, ...extra,
});
const models = () =>
  vi.fn(async () =>
    Response.json({ data: [{ id: "openai/gpt-5-mini", pricing: { prompt: "0.00000025", completion: "0.000002" } }] }),
  );

describe("resolveCosts", () => {
  it("keeps a reported cost and fetches nothing", async () => {
    const fetchImpl = models();
    const [r] = await pricingWith(fetchImpl)([call({ cost: 777 })]);
    expect(r).toMatchObject({ cost: 777, costSource: "reported" });
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("estimates a missing cost from OpenRouter's prices", async () => {
    const [r] = await pricingWith(models())([call()]);
    // 1000 × 0.25 + 100 × 2 micro-dollars per token
    expect(r).toMatchObject({ cost: 450, costSource: "estimated" });
  });

  it("prices embeddings from the constant, without fetching", async () => {
    const fetchImpl = models();
    const [r] = await pricingWith(fetchImpl)([call({ role: "embedding", model: "openai/text-embedding-3-small", inputTokens: 1_000_000, outputTokens: 0 })]);
    expect(r).toMatchObject({ cost: 20_000, costSource: "estimated" });
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("prices speech from the fixed TTS price, without fetching", async () => {
    const fetchImpl = models();
    const [r] = await pricingWith(fetchImpl)([call({ role: "tts", model: TTS_MODEL, inputTokens: 100, outputTokens: 960 })]);
    // 100 × 0.5 + 960 × 9 micro-dollars per token
    expect(r).toMatchObject({ cost: 8_690, costSource: "estimated" });
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("warns once per model missing from the price list", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    try {
      const resolve = pricingWith(models());
      await resolve([call({ model: "someone/else" }), call({ model: "someone/else" })]);
      await resolve([call({ model: "someone/else" }), call()]);
      expect(warn).toHaveBeenCalledTimes(1);
      expect(warn.mock.calls[0]?.join(" ")).toContain("someone/else");
    } finally {
      warn.mockRestore();
    }
  });

  it("fetches the price list once a day", async () => {
    const fetchImpl = models();
    let t = 0;
    const resolve = pricingWith(fetchImpl, () => t);
    await resolve([call()]);
    t = 23 * 3_600_000;
    await resolve([call()]);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    t = 25 * 3_600_000;
    await resolve([call()]);
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });

  it("logs an unknown model or a failed price list at 0, estimated, without throwing", async () => {
    const quiet = vi.spyOn(console, "error").mockImplementation(() => {});
    const quietWarn = vi.spyOn(console, "warn").mockImplementation(() => {});
    try {
      const [unknown] = await pricingWith(models())([call({ model: "someone/else" })]);
      expect(unknown).toMatchObject({ cost: 0, costSource: "estimated" });
      const [failed] = await pricingWith(vi.fn(async () => new Response("down", { status: 503 })))([call()]);
      expect(failed).toMatchObject({ cost: 0, costSource: "estimated" });
    } finally {
      quiet.mockRestore();
      quietWarn.mockRestore();
    }
  });

  it("handles fetch timeout, returning 0 estimated cost", async () => {
    const quiet = vi.spyOn(console, "error").mockImplementation(() => {});
    const quietWarn = vi.spyOn(console, "warn").mockImplementation(() => {});
    try {
      let capturedSignal: AbortSignal | null | undefined;
      const timingOutFetch = vi.fn(async (url: string | URL, init?: RequestInit) => {
        capturedSignal = init?.signal;
        return new Promise<Response>((_, reject) => {
          expect(init?.signal).toBeInstanceOf(AbortSignal);
          init?.signal?.addEventListener("abort", () => {
            reject(new DOMException("The operation was aborted.", "AbortError"));
          });
        });
      }) as typeof fetch;
      const [r] = await pricingWith(timingOutFetch, undefined, 20)([call()]);
      expect(r).toMatchObject({ cost: 0, costSource: "estimated" });
      expect(capturedSignal).toBeInstanceOf(AbortSignal);
    } finally {
      quiet.mockRestore();
      quietWarn.mockRestore();
    }
  });
});
