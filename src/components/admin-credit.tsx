"use client";

import { useEffect, useState } from "react";
import ConfirmDialog from "@/components/confirm-dialog";
import GearIcon from "@/components/gear-icon";
import { creditWarnings, gapTooBig, startingEnergyConfirm, type SpendReport } from "@/lib/admin-spend";
import { formatDollars, MICROS_PER_DOLLAR, parseGrant } from "@/lib/money";

/** Spec §26.6: the OpenRouter credit card and the starting-energy setting, at the top of /admin. */
export default function AdminCredit({ onStartingEnergy }: { onStartingEnergy: (amount: string) => void }) {
  const [report, setReport] = useState<SpendReport | null>(null);
  const [failed, setFailed] = useState(false);
  // The stored value ("1.00"); the edit row works on a draft, saved only after the confirmation.
  const [starting, setStarting] = useState("");
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState("");
  const [confirming, setConfirming] = useState(false);
  const [saved, setSaved] = useState<string | null>(null);

  useEffect(() => {
    void fetch("/api/admin/spend")
      .then((r) => (r.ok ? r.json() : Promise.reject()))
      .then(setReport, () => setFailed(true));
    void fetch("/api/admin/settings")
      .then((r) => (r.ok ? r.json() : Promise.reject()))
      .then((d: { startingEnergy: number }) => {
        const value = (d.startingEnergy / MICROS_PER_DOLLAR).toFixed(2);
        setStarting(value);
        onStartingEnergy(value);
      }, () => {});
  }, [onStartingEnergy]);

  function toggleEditing() {
    setEditing((open) => !open);
    setDraft(starting);
    setSaved(null);
  }

  async function save() {
    setConfirming(false);
    let ok = false;
    try {
      const res = await fetch("/api/admin/settings", { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ startingEnergy: draft }) });
      ok = res.ok;
      setSaved(ok ? "Saved" : "Enter an amount from 0.01 to 5.00.");
    } catch {
      setSaved("Couldn't reach the server.");
    }
    if (!ok) return; // stays in the edit row with the message
    setStarting(draft);
    setEditing(false);
    onStartingEnergy(draft);
  }

  const draftMicros = parseGrant(draft);
  const c = report?.credit;
  const card = "rounded-2xl border border-white/10 bg-neutral-900/80 px-4 py-3 text-sm";
  return (
    <>
      <div className={card}>
        <p className="font-medium">OpenRouter credit</p>
        {failed ? (
          <p className="text-neutral-400">Couldn&apos;t load spend.</p>
        ) : !report ? (
          <p className="text-neutral-500">Loading…</p>
        ) : (
          <>
            {c && (
              <p>
                <b>{c.remaining === null ? "No limit" : formatDollars(c.remaining)}</b>
                {c.limit !== null && <span className="text-neutral-400"> left of {formatDollars(c.limit)}</span>}
              </p>
            )}
            <p className="text-xs text-neutral-400">
              Spent today {formatDollars(c?.billed.today ?? report.logged.today.cost)} · this week {formatDollars(c?.billed.week ?? report.logged.week.cost)} · this month{" "}
              {formatDollars(c?.billed.month ?? report.logged.month.cost)}{" "}
              <span className={c && gapTooBig(c.billed.month, report.logged.month.cost) ? "text-amber-300" : ""}>
                (logged {formatDollars(report.logged.month.cost)})
              </span>
            </p>
            {creditWarnings(report).map((w) => (
              <p key={w} className="mt-1.5 rounded-xl bg-yellow-500/10 px-3 py-1.5 text-xs text-yellow-200">
                ⚠ {w}
              </p>
            ))}
          </>
        )}
      </div>
      {/* Read-only until the gear is pressed, like the persona picker; Save asks first (spec §26.6). */}
      <div className={`${card} flex flex-col gap-2`}>
        <div className="flex items-center justify-between gap-2">
          <span>
            Starting energy <span className="tabular-nums text-neutral-300">{starting ? `$${starting}` : "—"}</span>
          </span>
          <button
            type="button"
            aria-label="Change starting energy"
            aria-pressed={editing}
            onClick={toggleEditing}
            disabled={!starting}
            className={`-my-1.5 flex size-11 shrink-0 items-center justify-center rounded-full transition-colors focus-visible:outline focus-visible:outline-white/40 disabled:pointer-events-none disabled:opacity-40 ${
              editing ? "bg-white/10 text-foreground" : "text-neutral-400 hover:bg-white/10 hover:text-foreground"
            }`}
          >
            <GearIcon open={editing} />
          </button>
        </div>
        {editing && (
          <form
            className="flex items-center gap-2"
            onSubmit={(e) => {
              e.preventDefault();
              if (draftMicros !== null) setConfirming(true);
            }}
          >
            <label htmlFor="starting-energy" className="flex min-w-0 flex-1 items-center gap-2">
              $
              <input
                id="starting-energy"
                inputMode="decimal"
                autoFocus
                value={draft}
                onChange={(e) => {
                  setDraft(e.target.value);
                  setSaved(null);
                }}
                aria-describedby={draftMicros === null ? "starting-energy-range" : undefined}
                className="w-20 rounded-xl border border-white/10 bg-neutral-950/60 px-2 py-1.5 text-base"
              />
            </label>
            <button type="button" onClick={toggleEditing} className="min-h-11 shrink-0 rounded-full px-3 text-sm text-neutral-400 hover:bg-white/10 hover:text-foreground">
              Cancel
            </button>
            <button
              type="submit"
              disabled={draftMicros === null}
              className="min-h-11 shrink-0 rounded-full border border-white/15 px-4 text-sm text-neutral-200 hover:bg-white/10 disabled:opacity-40"
            >
              Save
            </button>
          </form>
        )}
        {/* Under the row, not in it: the row has to fit a phone on one line. */}
        {editing && draftMicros === null && (
          <p id="starting-energy-range" className="text-xs text-neutral-500">
            Enter an amount from 0.01 to 5.00.
          </p>
        )}
        {saved && <p role="status" className="text-xs text-neutral-400">{saved}</p>}
      </div>
      <ConfirmDialog
        open={confirming}
        title="Change the starting energy?"
        message={draftMicros === null ? "" : startingEnergyConfirm(parseGrant(starting) ?? 0, draftMicros)}
        confirmLabel="Save"
        onConfirm={() => void save()}
        onCancel={() => setConfirming(false)}
      />
    </>
  );
}
