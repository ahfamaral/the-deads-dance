import { ALERT, BODY, CARD, MUTED, ROW } from "@/components/admin-styles";
import { formatDollars } from "@/lib/money";
import type { RoundEvent } from "@/lib/persona-profile";

export type ProgressLine = { label: string; state: "running" | "done" | "skipped" };

/**
 * One line per item, in the order the round reports them. A start opens a line; its finish closes
 * it. A finish under another label closes the running line and renames it (a redraft finishes as
 * "Highlights and character redrafted"); a finish with nothing running is a line of its own (a
 * kept or removed source).
 */
export function progressLines(events: readonly RoundEvent[]): ProgressLine[] {
  const lines: ProgressLine[] = [];
  for (const e of events) {
    if (e.type !== "progress") continue;
    if (e.status === "started") {
      lines.push({ label: e.label, state: "running" });
      continue;
    }
    const state = e.status === "finished" ? "done" : "skipped";
    const running = lines.findLast((l) => l.state === "running" && l.label === e.label) ?? lines.findLast((l) => l.state === "running");
    if (running) {
      running.label = e.label;
      running.state = state;
    } else lines.push({ label: e.label, state });
  }
  return lines;
}

const STATE_LABEL: Record<ProgressLine["state"], string> = { running: "working", done: "done", skipped: "skipped" };

/**
 * Spec §34.5, §34.8 (mockup 1c): the round item by item: a segmented bar, a line per item and
 * what has been spent. Before the first event the server is still fetching the texts (it answers
 * once the first paid call starts).
 */
export default function RoundProgress({ events }: { events: RoundEvent[] }) {
  const lines = progressLines(events);
  const last = events.at(-1);
  const failed = last?.type === "error" ? last : null;
  const finished = last?.type === "done" || failed !== null;
  const spent = last?.type === "done" ? last.cost : (events.findLast((e) => e.type === "progress")?.spent ?? 0);
  const done = lines.filter((l) => l.state !== "running").length;
  // While it runs, one more segment stands for what is still to come.
  const segments = finished ? lines.length : lines.length + 1;
  const now = events.length === 0 ? "Fetching texts…" : (lines.findLast((l) => l.state === "running")?.label ?? (finished ? null : "Working…"));

  return (
    <div className="flex flex-col gap-3">
      <div
        role="progressbar"
        aria-label="Round progress"
        aria-valuemin={0}
        aria-valuemax={segments}
        aria-valuenow={done}
        className="flex gap-1"
      >
        {Array.from({ length: segments }, (_, i) => {
          const line = lines[i];
          return (
            <div key={i} data-segment={line?.state ?? "waiting"} className="h-1.5 flex-1 overflow-hidden rounded-full bg-white/10">
              {line && line.state !== "running" && <div className={`h-full w-full ${line.state === "done" ? "bg-lime-400" : "bg-neutral-500"}`} />}
              {line?.state === "running" && <div className="h-full w-1/2 animate-pulse bg-lime-400 motion-reduce:animate-none" />}
            </div>
          );
        })}
      </div>
      {now && (
        <p role="status" aria-live="polite" className={BODY}>
          {now}
        </p>
      )}
      {failed && (
        <p role="alert" className={ALERT}>
          {failed.message}
        </p>
      )}
      {lines.length > 0 && (
        <ul className={CARD}>
          {lines.map((l, i) => (
            <li key={i} className={`${ROW} text-base sm:text-sm`}>
              <span className="min-w-0 break-words text-neutral-200">{l.label}</span>
              <span className={`shrink-0 ${l.state === "done" ? "text-lime-400" : "text-neutral-400"}`}>{STATE_LABEL[l.state]}</span>
            </li>
          ))}
        </ul>
      )}
      <p className={MUTED}>{`Spent so far ${formatDollars(spent)}`}</p>
    </div>
  );
}
