import Link from "next/link";
import { Stars } from "@/components/admin-feedback";
import type { FeedbackReport } from "@/lib/feedback";

const when = (iso: string) => new Date(iso).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" });
const OPEN = "inline-flex min-h-11 shrink-0 items-center whitespace-nowrap rounded-full border border-white/15 px-4 text-base text-neutral-200 hover:bg-white/10 sm:text-sm";

/** Spec §34.4: the testers' ratings of this persona, newest first, as cards that fit a phone and a desktop. */
export default function PersonaRatings({ report }: { report: FeedbackReport }) {
  const { summary, items } = report;
  if (summary.count === 0) return <p className="text-base text-neutral-400 sm:text-sm">No ratings yet.</p>;
  return (
    <div className="flex flex-col gap-3">
      <p className="text-base font-medium sm:text-sm">
        {summary.count} {summary.count === 1 ? "rating" : "ratings"}, average {(summary.average ?? 0).toFixed(1)} ★
      </p>
      <ul className="flex flex-col gap-2">
        {items.map((i) => (
          <li key={i.conversationId} className="flex flex-col gap-1.5 rounded-xl border border-white/10 bg-neutral-900/70 p-3 text-base sm:text-sm">
            <div className="flex items-center justify-between gap-2">
              <Stars stars={i.stars} />
              <Link href={`/?open=${i.conversationId}`} className={OPEN}>
                Open
              </Link>
            </div>
            {i.comment && <p className="whitespace-pre-wrap break-words text-neutral-300">{i.comment}</p>}
            <p className="break-all text-neutral-400">{i.email}</p>
            <p className="text-neutral-400">
              {when(i.createdAt)}
              {i.edited && <span className="ml-2 text-neutral-500">edited</span>}
            </p>
          </li>
        ))}
      </ul>
    </div>
  );
}
