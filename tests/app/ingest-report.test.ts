import { describe, expect, it } from "vitest";
import { ingestReport } from "@/lib/ingest-report";
import type { ResolvedCall } from "@/lib/server/pricing";

const call = (role: ResolvedCall["role"], inputTokens: number, cost: number, costSource: ResolvedCall["costSource"] = "reported"): ResolvedCall => ({
  role, model: "m", inputTokens, outputTokens: 0, cost, costSource, generationId: null, latencyMs: 1,
});

describe("ingestReport (spec §26.6)", () => {
  it("groups by step, in a fixed order, with a total", () => {
    expect(ingestReport([call("embedding", 84_000, 2_000, "estimated"), call("ingest", 12_400, 41_000), call("embedding", 0, 0, "estimated")])).toEqual({
      rows: [
        { label: "Character profile", tokens: 12_400, cost: 41_000, estimated: false },
        { label: "Embeddings", tokens: 84_000, cost: 2_000, estimated: true },
      ],
      total: { tokens: 96_400, cost: 43_000 },
    });
  });

  it("is empty when nothing was called", () => {
    expect(ingestReport([])).toEqual({ rows: [], total: { tokens: 0, cost: 0 } });
  });
});
