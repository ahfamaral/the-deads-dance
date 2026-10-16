"use client";

import { useState, type FormEvent } from "react";
import type { AddPersonaEvent } from "@/lib/add-persona-events";
import { applyProgress, initialProgress, LONG_WAIT_HINT, progressView, SEGMENTS, type ProgressState } from "@/lib/add-persona-progress";
import type { IngestReport } from "@/lib/ingest-report";
import { formatDollars, formatTokens } from "@/lib/money";
import { readNdjson } from "@/lib/ndjson";
import type { Persona } from "@/lib/personas";

type AddPersonaFormProps = {
  onAdded: (persona: Persona) => void;
  onCancel: () => void;
  /** Told when adding starts and ends, so the surrounding panel can lock itself meanwhile. */
  onWorkingChange: (working: boolean) => void;
  /** Spec §33.3: the admin chose to create a voice for the persona just added; the form is done. */
  onCreateVoice: (persona: Persona) => void;
  /** Tests only: starts the form in this phase. */
  initialPhase?: Phase;
};

type Phase =
  | { kind: "idle" }
  | { kind: "working"; progress: ProgressState | null } // null: still looking up the article
  | { kind: "report"; persona: Persona; report: IngestReport }
  | { kind: "error"; message: string };

/** Adds a persona from an English Wikipedia title, showing the ingest stages as a segmented bar (spec §17.5). */
export default function AddPersonaForm({ onAdded, onCancel, onWorkingChange, onCreateVoice, initialPhase }: AddPersonaFormProps) {
  const [title, setTitle] = useState("");
  const [phase, setPhase] = useState<Phase>(initialPhase ?? { kind: "idle" });
  const working = phase.kind === "working";

  async function submit(event: FormEvent) {
    event.preventDefault();
    setPhase({ kind: "working", progress: null });
    onWorkingChange(true);
    try {
      const res = await fetch("/api/personas", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ wikipediaTitle: title }),
      });
      if (!res.ok || !res.body) {
        const data = await res.json().catch(() => ({}));
        setPhase({ kind: "error", message: data.error ?? "Adding the persona failed." });
        return;
      }
      let report: IngestReport | null = null;
      for await (const e of readNdjson<AddPersonaEvent>(res.body)) {
        if (e.type === "progress") {
          setPhase((prev) => ({
            kind: "working",
            progress: applyProgress(prev.kind === "working" && prev.progress ? prev.progress : initialProgress(), e),
          }));
        } else if (e.type === "cost") report = e.report;
        else if (e.type === "done") return report && report.rows.length > 0 ? setPhase({ kind: "report", persona: e.persona, report }) : onAdded(e.persona);
        else return setPhase({ kind: "error", message: e.message });
      }
      setPhase({ kind: "error", message: "The server stopped before finishing." });
    } catch {
      setPhase({ kind: "error", message: "Couldn't reach the server." });
    } finally {
      onWorkingChange(false);
    }
  }

  const view = phase.kind === "working" && phase.progress ? progressView(phase.progress) : null;
  const status =
    phase.kind === "working" ? (view?.line ?? "Looking up the article…") : phase.kind === "error" ? phase.message : "";

  if (phase.kind === "report") {
    return (
      <div className="mb-2 flex flex-col gap-2 rounded-2xl border border-white/10 bg-white/5 p-3 text-sm">
        <p className="text-neutral-300">Persona added: {phase.persona.name}</p>
        <table className="w-full text-xs tabular-nums text-neutral-400">
          <tbody>
            {phase.report.rows.map((row) => (
              <tr key={row.label}>
                <td className="py-0.5">{row.label}</td>
                <td className="py-0.5 text-right">{formatTokens(row.tokens)}</td>
                <td className="py-0.5 text-right">
                  {formatDollars(row.cost)}
                  {row.estimated && " (estimated)"}
                </td>
              </tr>
            ))}
            <tr className="border-t border-white/10 text-neutral-200">
              <td className="pt-1">Total</td>
              <td className="pt-1 text-right">{formatTokens(phase.report.total.tokens)}</td>
              <td className="pt-1 text-right">{formatDollars(phase.report.total.cost)}</td>
            </tr>
          </tbody>
        </table>
        <div className="flex flex-col gap-2 border-t border-white/10 pt-2">
          <p className="text-neutral-300">Create a voice for {phase.persona.name}?</p>
          <div className="flex justify-end gap-2">
            <button
              type="button"
              onClick={() => onAdded(phase.persona)}
              className="min-h-11 rounded-full px-4 py-1.5 text-sm text-neutral-400 transition-colors hover:bg-white/10 hover:text-foreground"
            >
              Not now
            </button>
            <button
              type="button"
              onClick={() => {
                onAdded(phase.persona);
                onCreateVoice(phase.persona);
              }}
              className="min-h-11 rounded-full bg-neutral-100 px-4 py-1.5 text-sm font-medium text-neutral-900 transition-colors hover:bg-white"
            >
              Create voice
            </button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <form onSubmit={submit} className="mb-2 flex flex-col gap-2 rounded-2xl border border-white/10 bg-white/5 p-3">
      <label htmlFor="add-persona-title" className="text-sm text-neutral-400">
        English Wikipedia article about a person
      </label>
      <input
        id="add-persona-title"
        value={title}
        onChange={(e) => setTitle(e.target.value)}
        disabled={working}
        maxLength={200}
        placeholder="e.g. Ada Lovelace"
        autoFocus
        className="rounded-xl border border-white/10 bg-neutral-950/60 px-3 py-2 text-sm text-foreground placeholder:text-neutral-600 focus-visible:border-white/40 focus-visible:outline-none"
      />
      {view && (
        <div className="flex flex-col gap-1">
          <div
            role="progressbar"
            aria-label="Adding the persona"
            aria-valuemin={0}
            aria-valuemax={SEGMENTS.length}
            aria-valuenow={view.finished}
            aria-valuetext={view.line}
            className="flex gap-1"
          >
            {view.segments.map(({ key, state }) => (
              <div key={key} className="h-1.5 flex-1 overflow-hidden rounded-full bg-white/10">
                {state === "done" && <div className="h-full w-full bg-neutral-200" />}
                {state === "running" && (
                  <div className="h-full w-full animate-pulse bg-neutral-400 motion-reduce:w-1/2 motion-reduce:animate-none" />
                )}
              </div>
            ))}
          </div>
          <p className="text-xs text-neutral-500">{LONG_WAIT_HINT}</p>
        </div>
      )}
      <div className="flex items-center justify-between gap-3">
        <p role="status" aria-live="polite" className={`text-sm ${phase.kind === "error" ? "text-red-400" : "text-neutral-400"}`}>
          {status}
        </p>
        <div className="flex shrink-0 gap-2">
          <button
            type="button"
            onClick={onCancel}
            disabled={working}
            className="rounded-full px-3 py-1.5 text-sm text-neutral-400 transition-colors hover:bg-white/10 hover:text-foreground disabled:opacity-40"
          >
            Cancel
          </button>
          <button
            type="submit"
            disabled={working || title.trim() === ""}
            className="rounded-full bg-neutral-100 px-4 py-1.5 text-sm font-medium text-neutral-900 transition-colors hover:bg-white disabled:opacity-40"
          >
            Add
          </button>
        </div>
      </div>
    </form>
  );
}
