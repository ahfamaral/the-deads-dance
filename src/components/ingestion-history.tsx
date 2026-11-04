import { formatDollars } from "@/lib/money";
import type { RoundDto } from "@/lib/persona-profile";

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/** "22 Oct 2026", in UTC so the server and the browser agree. */
export function roundDate(iso: string): string {
  const d = new Date(iso);
  return `${d.getUTCDate()} ${MONTHS[d.getUTCMonth()]} ${d.getUTCFullYear()}`;
}

/** Spec §34.2: a spent cost is exact unless one of its calls was estimated (embeddings report none): then "about". */
const cost = (micros: number | null, estimated = false) =>
  micros === null ? "cost not recorded" : `${estimated ? "about " : ""}${formatDollars(micros)}`;
const PRICE = "shrink-0 whitespace-nowrap text-right tabular-nums";

const anyEstimated = (r: RoundDto) => r.items.some((i) => i.costEstimated);
/** The labels already carry most counts ("Portuguese article, 212 passages", "Real quotes, 22"). */
const labelHasCount = (label: string, passages: number) => new RegExp(`, ${passages}(?: passages?)?(?: \\(|$)`).test(label);
const plural = (n: number) => `${n} passage${n === 1 ? "" : "s"}`;

/** Spec §34.4: total spent, then one block per round, newest first, each item with its cost. */
export default function IngestionHistory({ rounds, spent }: { rounds: RoundDto[]; spent: number }) {
  return (
    <div className="flex flex-col gap-3 text-base sm:text-sm">
      <p className="text-neutral-400">Spent on this memory so far: {cost(spent, rounds.some(anyEstimated))}</p>
      {rounds.map((r) => (
        <section key={r.id} aria-label={`Round ${r.number}`} className="flex flex-col gap-1 border-t border-white/10 pt-3">
          <div className="flex min-h-8 items-baseline justify-between gap-3 font-semibold">
            <h3>{`Round ${r.number}, ${roundDate(r.startedAt)}`}</h3>
            <span className={`${PRICE} ${r.cost === null ? "font-normal text-neutral-400" : ""}`}>{cost(r.cost, anyEstimated(r))}</span>
          </div>
          {r.note && <p className="text-lime-400">{r.note}</p>}
          <ul className="flex flex-col">
            {r.items.map((it) => (
              <li key={it.id} className="flex justify-between gap-3 py-1 pl-3 text-neutral-200">
                <span className="min-w-0 break-words">
                  {it.label}
                  {it.passages !== null && it.passages > 0 && !labelHasCount(it.label, it.passages) && (
                    <span className="block text-neutral-400">{plural(it.passages)}</span>
                  )}
                </span>
                <span className={`${PRICE} ${it.cost === null ? "text-neutral-400" : ""}`}>{cost(it.cost, it.costEstimated)}</span>
              </li>
            ))}
          </ul>
        </section>
      ))}
    </div>
  );
}
