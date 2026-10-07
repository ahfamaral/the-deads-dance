import type { ResolvedCall } from "@/lib/server/pricing";

/** Spec §26.6: what adding a persona cost, by step. The types are browser-safe; the form renders them. */
export type IngestReportRow = { label: string; tokens: number; cost: number; estimated: boolean };
export type IngestReport = { rows: IngestReportRow[]; total: { tokens: number; cost: number } };

const STEPS: { label: string; roles: ResolvedCall["role"][] }[] = [
  { label: "Character profile", roles: ["ingest"] },
  { label: "Helper calls", roles: ["helper", "recall", "classifier", "agent"] },
  { label: "Embeddings", roles: ["embedding"] },
];

export function ingestReport(calls: readonly ResolvedCall[]): IngestReport {
  const rows = STEPS.flatMap(({ label, roles }) => {
    const mine = calls.filter((c) => roles.includes(c.role));
    if (mine.length === 0) return [];
    const tokens = mine.reduce((n, c) => n + c.inputTokens + c.outputTokens, 0);
    const cost = mine.reduce((n, c) => n + c.cost, 0);
    if (tokens === 0 && cost === 0) return [];
    return [{ label, tokens, cost, estimated: mine.some((c) => c.costSource === "estimated") }];
  });
  return { rows, total: { tokens: rows.reduce((n, r) => n + r.tokens, 0), cost: rows.reduce((n, r) => n + r.cost, 0) } };
}
