import type { Spend, TurnSpend } from "@/lib/chat-types";
import { formatDollars, formatTokens, spendLabel } from "@/lib/money";

/** Spec §26.6, admin only: tokens and dollars. Tap or click opens the last turn's breakdown. */
export default function SpendBadge({ spend, lastTurn, suffix }: { spend: Spend; lastTurn?: TurnSpend | null; suffix?: string }) {
  const label = `${spendLabel(spend)}${suffix ? ` ${suffix}` : ""}`;
  if (lastTurn === undefined) return <span className="shrink-0 whitespace-nowrap text-xs tabular-nums text-neutral-400">{label}</span>;
  return (
    <details className="relative shrink-0 text-xs tabular-nums text-neutral-400">
      <summary className="cursor-pointer inline-flex min-h-11 whitespace-nowrap items-center list-none rounded-full px-3 text-xs hover:bg-white/10 [&::-webkit-details-marker]:hidden">{label}</summary>
      <div className="absolute right-0 z-20 mt-1 w-max max-w-[calc(100vw-2rem)] rounded-xl border border-white/10 bg-neutral-900 px-3 py-2 text-neutral-300 shadow-lg shadow-black/40">
        {lastTurn ? (
          <>
            <p>Last turn: {formatDollars(lastTurn.cost)}</p>
            <p>
              {formatTokens(lastTurn.inputTokens)} in · {formatTokens(lastTurn.outputTokens)} out
            </p>
          </>
        ) : (
          <p>No turns yet.</p>
        )}
      </div>
    </details>
  );
}
