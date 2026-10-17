"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { starsText, type FeedbackItem, type FeedbackReport } from "@/lib/feedback";

/** The report, or null when it couldn't be loaded. */
async function fetchFeedback(): Promise<FeedbackReport | null> {
  const res = await fetch("/api/admin/feedback", { cache: "no-store" }).catch(() => null);
  return res?.ok ? ((await res.json()) as FeedbackReport) : null;
}

const when = (iso: string) => new Date(iso).toLocaleDateString(undefined, { month: "short", day: "numeric" });
const avg = (n: number) => n.toFixed(1);
const OPEN = "inline-flex min-h-11 shrink-0 items-center whitespace-nowrap rounded-full border border-white/15 px-4 text-base sm:text-sm text-neutral-200 hover:bg-white/10";

function Stars({ stars }: { stars: number }) {
  return (
    <>
      <span className="sr-only">{stars} of 5 stars</span>
      <span aria-hidden="true" className="text-amber-400">
        {starsText(stars)}
      </span>
    </>
  );
}

/** A long comment shows 3 lines; a tap shows it all. */
function Comment({ text }: { text: string }) {
  const [open, setOpen] = useState(false);
  if (!text) return <span className="text-neutral-500">—</span>;
  return (
    <button
      type="button"
      onClick={() => setOpen((o) => !o)}
      aria-expanded={open}
      className={`w-full whitespace-pre-wrap break-words text-left text-neutral-300 ${open ? "" : "line-clamp-3"}`}
    >
      {text}
    </button>
  );
}

const meta = (i: FeedbackItem) => `${i.email} · ${i.personaName} · ${when(i.createdAt)}${i.edited ? " · edited" : ""}`;

/** Spec §32.7: the summary, then every rating, newest first. A table on desktop, cards on phones. */
export function FeedbackReportView({ report }: { report: FeedbackReport }) {
  const { summary, items } = report;
  if (summary.count === 0) return <p className="text-sm text-neutral-500">No ratings yet.</p>;
  return (
    <div className="flex min-h-0 flex-1 flex-col gap-3">
      <div className="rounded-2xl border border-white/10 bg-neutral-900/70 p-3 text-sm">
        <p className="font-medium">
          {summary.count} {summary.count === 1 ? "rating" : "ratings"} · avg {avg(summary.average ?? 0)} ★
        </p>
        <ul className="mt-1 text-neutral-400">
          {summary.perPersona.map((p) => (
            <li key={p.personaName}>
              {p.personaName}: {avg(p.average)} ★ ({p.count})
            </li>
          ))}
        </ul>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto bg-neutral-900/50">
        {/* Desktop: a table */}
        <table className="hidden w-full text-sm md:table">
          <thead>
            <tr className="text-left text-xs uppercase tracking-wider text-neutral-500">
              <th className="px-2 py-2 font-medium">Stars</th>
              <th className="px-2 py-2 font-medium">Comment</th>
              <th className="px-2 py-2 font-medium">Tester</th>
              <th className="px-2 py-2 font-medium">Persona</th>
              <th className="px-2 py-2 font-medium">Date</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {items.map((i) => (
              <tr key={i.conversationId} className="border-t border-white/5 align-top">
                <td className="whitespace-nowrap px-2 py-2">
                  <Stars stars={i.stars} />
                </td>
                <td className="max-w-sm px-2 py-2">
                  <Comment text={i.comment} />
                </td>
                <td className="break-all px-2 py-2 text-neutral-400">{i.email}</td>
                <td className="px-2 py-2 text-neutral-400">{i.personaName}</td>
                <td className="whitespace-nowrap px-2 py-2 text-neutral-400">
                  {when(i.createdAt)}
                  {i.edited && " · edited"}
                </td>
                <td className="px-2 py-2">
                  <Link href={`/?open=${i.conversationId}`} className={OPEN}>
                    Open
                  </Link>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {/* Phone: cards */}
        <ul className="flex flex-col gap-2 md:hidden">
          {items.map((i) => (
            <li key={i.conversationId} className="flex flex-col gap-1.5 rounded-2xl border border-white/10 bg-neutral-900/90 p-3 text-sm">
              <div className="flex items-center justify-between gap-2">
                <span>
                  <Stars stars={i.stars} />
                </span>
                <Link href={`/?open=${i.conversationId}`} className={OPEN}>
                  Open
                </Link>
              </div>
              <Comment text={i.comment} />
              <p className="break-all text-xs text-neutral-500">{meta(i)}</p>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}

/** Spec §32.7: the admin's Feedback tab. */
export default function AdminFeedback() {
  const [report, setReport] = useState<FeedbackReport | null>(null);
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    void fetchFeedback().then((r) => (r ? setReport(r) : setFailed(true)));
  }, []);
  if (failed) return <p className="text-sm text-neutral-500">Couldn&apos;t load feedback.</p>;
  if (!report) return <p className="text-sm text-neutral-500">Loading…</p>;
  return <FeedbackReportView report={report} />;
}
