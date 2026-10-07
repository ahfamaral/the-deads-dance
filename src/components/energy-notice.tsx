import { BANNER, type BannerThreshold } from "@/lib/energy";

const TONE: Record<BannerThreshold, string> = {
  50: "bg-yellow-500/10 text-yellow-200",
  20: "bg-red-500/10 text-red-200",
  10: "bg-red-800/25 text-red-300",
  0: "bg-neutral-200/10 text-neutral-100",
};

/** Spec §26.5: one banner, in the level's colour; × marks it read. */
export default function EnergyNotice({ threshold, onDismiss, className = "border-b border-white/10" }: { threshold: BannerThreshold; onDismiss: () => void; className?: string }) {
  return (
    <p role="status" className={`flex items-center gap-2 px-4 py-1.5 text-xs ${TONE[threshold]} ${className}`}>
      <span className="flex-1">⚡ {BANNER[threshold]}</span>
      <button
        type="button"
        aria-label="Dismiss"
        onClick={onDismiss}
        className="flex -my-2.5 size-11 shrink-0 items-center justify-center rounded-full text-base leading-none opacity-70 transition-opacity hover:opacity-100 focus-visible:outline focus-visible:outline-white/40"
      >
        ×
      </button>
    </p>
  );
}
