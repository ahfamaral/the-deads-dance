import { describe, expect, it, vi } from "vitest";
import { applyMeterEvent, isOutOfEnergy, markBannerRead, parseMeter } from "@/lib/meter";

describe("meter (spec §26.5–6)", () => {
  it("reads the access body", () => {
    expect(parseMeter({ energy: { left: 0.18, warningRead: 50 } })).toEqual({ kind: "energy", left: 0.18, warningRead: 50 });
    expect(parseMeter({ spend: { today: { tokens: 10, cost: 5 } } })).toEqual({ kind: "spend", today: { tokens: 10, cost: 5 } });
    expect(parseMeter({ energy: { left: "lots" } })).toBeNull();
    expect(parseMeter(null)).toBeNull();
  });

  it("follows the stream: energy for testers, spend today for the admin", () => {
    const tester = { kind: "energy" as const, left: 0.5, warningRead: 100 as const };
    expect(applyMeterEvent(tester, { type: "energy", left: 0.4 })).toEqual({ ...tester, left: 0.4 });
    const admin = { kind: "spend" as const, today: { tokens: 10, cost: 5 } };
    expect(applyMeterEvent(admin, { type: "cost", turn: { tokens: 3, cost: 2, inputTokens: 2, outputTokens: 1 }, conversation: { tokens: 3, cost: 2 } })).toEqual({
      kind: "spend", today: { tokens: 13, cost: 7 },
    });
    expect(applyMeterEvent(tester, { type: "token", text: "x" })).toBe(tester);
  });

  it("knows when a tester is out of energy", () => {
    expect(isOutOfEnergy({ kind: "energy", left: 0, warningRead: 100 })).toBe(true);
    expect(isOutOfEnergy({ kind: "energy", left: 0.01, warningRead: 100 })).toBe(false);
    expect(isOutOfEnergy({ kind: "spend", today: { tokens: 0, cost: 0 } })).toBe(false);
    expect(isOutOfEnergy(null)).toBe(false);
  });

  it("tells the server a banner was read, and ignores a failure", async () => {
    const fetchImpl = vi.fn(async () => new Response(null, { status: 204 }));
    await markBannerRead(20, fetchImpl);
    expect(fetchImpl).toHaveBeenCalledWith("/api/energy/read", expect.objectContaining({ method: "POST", body: JSON.stringify({ threshold: 20 }) }));
    await expect(markBannerRead(20, vi.fn(async () => { throw new Error("offline"); }))).resolves.toBeUndefined();
  });
});
