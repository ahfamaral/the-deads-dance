import type { ChatStreamEvent, Spend } from "@/lib/chat-types";
import { isThreshold, type BannerThreshold, type Threshold } from "@/lib/energy";

/** Spec §26.5–6: what the header shows. Testers get a fraction; the admin gets spend. */
export type Meter = { kind: "energy"; left: number; warningRead: Threshold } | { kind: "spend"; today: Spend };

const isNum = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v);

export function parseMeter(body: unknown): Meter | null {
  const b = body as { energy?: { left?: unknown; warningRead?: unknown }; spend?: { today?: { tokens?: unknown; cost?: unknown } } } | null;
  if (b?.energy && isNum(b.energy.left) && isThreshold(b.energy.warningRead)) {
    return { kind: "energy", left: b.energy.left, warningRead: b.energy.warningRead };
  }
  const today = b?.spend?.today;
  if (today && isNum(today.tokens) && isNum(today.cost)) return { kind: "spend", today: { tokens: today.tokens, cost: today.cost } };
  return null;
}

export function applyMeterEvent(meter: Meter, event: ChatStreamEvent): Meter {
  if (event.type === "energy" && meter.kind === "energy") return { ...meter, left: event.left };
  if (event.type === "cost" && meter.kind === "spend") {
    return { kind: "spend", today: { tokens: meter.today.tokens + event.turn.tokens, cost: meter.today.cost + event.turn.cost } };
  }
  return meter;
}

export const isOutOfEnergy = (meter: Meter | null) => meter?.kind === "energy" && meter.left <= 0;

/** Spec §26.5: a failure is ignored; the banner comes back on the next load. */
export async function markBannerRead(threshold: BannerThreshold, fetchImpl: typeof fetch = (...a) => window.fetch(...a)): Promise<void> {
  try {
    await fetchImpl("/api/energy/read", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ threshold }) });
  } catch {
    // ignored
  }
}
