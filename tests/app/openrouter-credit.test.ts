import { describe, expect, it, vi } from "vitest";
import { keyCreditWith } from "@/lib/server/openrouter-credit";

const key = (data: Record<string, unknown>) => vi.fn(async () => Response.json({ data }));

describe("keyCredit (spec §26.6)", () => {
  it("reads the key's limit, what's left and the billed spend, in micro-dollars", async () => {
    const fetchImpl = key({ limit: 10, limit_remaining: 6.4, usage_daily: 0.38, usage_weekly: 2.1, usage_monthly: 3.6 });
    expect(await keyCreditWith(fetchImpl, Date.now, () => "k")()).toEqual({
      limit: 10_000_000, remaining: 6_400_000, billed: { today: 380_000, week: 2_100_000, month: 3_600_000 },
    });
    expect(fetchImpl).toHaveBeenCalledWith("https://openrouter.ai/api/v1/key", { headers: { Authorization: "Bearer k" }, signal: expect.any(AbortSignal) });
  });

  it("knows a key with no limit", async () => {
    const credit = await keyCreditWith(key({ limit: null, limit_remaining: null, usage_daily: 0, usage_weekly: 0, usage_monthly: 0 }), Date.now, () => "k")();
    expect(credit?.limit).toBeNull();
  });

  it("caches for 60 seconds", async () => {
    const fetchImpl = key({ limit: 10, limit_remaining: 6, usage_daily: 0, usage_weekly: 0, usage_monthly: 0 });
    let t = 0;
    const credit = keyCreditWith(fetchImpl, () => t, () => "k");
    await credit();
    t = 59_000;
    await credit();
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    t = 61_000;
    await credit();
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });

  it("answers null when OpenRouter can't be reached", async () => {
    const quiet = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      expect(await keyCreditWith(vi.fn(async () => { throw new Error("offline"); }), Date.now, () => "k")()).toBeNull();
    } finally {
      quiet.mockRestore();
    }
  });

  it("gives up on a /key fetch that never answers", async () => {
    const quiet = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      let signal: AbortSignal | null | undefined;
      const hang = vi.fn((_url: unknown, init?: RequestInit) => {
        signal = init?.signal;
        return new Promise<Response>((_res, rej) => init?.signal?.addEventListener("abort", () => rej(new Error("aborted"))));
      });
      expect(await keyCreditWith(hang as unknown as typeof fetch, Date.now, () => "k", 20)()).toBeNull();
      expect(signal).toBeInstanceOf(AbortSignal);
    } finally {
      quiet.mockRestore();
    }
  });
});
