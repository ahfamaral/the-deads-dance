import { levelOf, percentLeft, type EnergyLevel } from "@/lib/energy";

const TONE: Record<EnergyLevel, { text: string; fill: string; pulse: string }> = {
  green: { text: "text-green-500", fill: "bg-green-500", pulse: "" },
  yellow: { text: "text-yellow-400", fill: "bg-yellow-400", pulse: "" },
  red: { text: "text-red-500", fill: "bg-red-500", pulse: "animate-[energy-pulse_1.8s_ease-in-out_infinite] motion-reduce:animate-none" },
  darkred: { text: "text-red-800", fill: "bg-red-800", pulse: "animate-[energy-pulse_0.7s_ease-in-out_infinite] motion-reduce:animate-none" },
  empty: { text: "text-neutral-200", fill: "", pulse: "" },
};

/** Spec §26.5: a bolt and a small bar; the pulse covers both. No money, ever. */
export default function EnergyBar({ left }: { left: number }) {
  const level = levelOf(left);
  const pct = percentLeft(left);
  const tone = TONE[level];
  return (
    <span
      role="meter"
      aria-label={`Energy: ${pct}% left`}
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={pct}
      className={`flex shrink-0 items-center gap-1.5 ${tone.text} ${tone.pulse}`}
    >
      <svg viewBox="0 0 24 24" fill="currentColor" className="size-3.5" aria-hidden="true">
        <path d="M13 2 4 14h7l-1 8 9-12h-7z" />
      </svg>
      <span className={`block h-1.5 w-12 overflow-hidden rounded-full ${level === "empty" ? "ring-1 ring-neutral-300" : "bg-white/10"}`}>
        <span className={`block h-full rounded-full ${tone.fill}`} style={{ width: `${pct}%` }} />
      </span>
    </span>
  );
}
