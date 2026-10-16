"use client";

import { languageName } from "@corpus/languages";
import { useEffect, useId, useRef, useState } from "react";
import ConfirmDialog from "@/components/confirm-dialog";
import { approveVoice, createVoice, fetchVoice, removeVoice, sampleUrl, saveVoice, type VoiceResult } from "@/lib/voice-api";
import { GEMINI_VOICES, type VoiceDto, type VoiceStatus } from "@/lib/voice";

export const DESCRIPTION_MAX = 600;
const BUTTON = "min-h-11 whitespace-nowrap rounded-full px-4 py-1.5 text-sm transition-colors disabled:opacity-40";
const FIELD =
  "w-full rounded-2xl border border-white/10 bg-neutral-950/60 px-3 py-2 text-base text-foreground focus-visible:outline focus-visible:outline-white/40 sm:text-sm";

type VoiceFormProps = {
  slug: string;
  voice: VoiceDto;
  /** The edited values; they differ from `voice` until Try again saves them. */
  baseVoice: string;
  description: string;
  busy: boolean;
  error: string | null;
  onBaseVoice: (value: string) => void;
  onDescription: (value: string) => void;
  onTryAgain: () => void;
  onApprove: () => void;
  onTurnOff: () => void;
};

/** Spec §33.3: the editable voice, its sample and the actions. Presentational, so it renders as static markup. */
export function VoiceForm({ slug, voice, baseVoice, description, busy, error, onBaseVoice, onDescription, onTryAgain, onApprove, onTurnOff }: VoiceFormProps) {
  const id = useId();
  const dirty = baseVoice !== voice.baseVoice || description !== voice.description;
  return (
    <div className="flex flex-col gap-3">
      <p className="text-xs text-neutral-400">Status: {voice.status === "approved" ? "Approved" : "Draft"}</p>
      <div className="flex flex-col gap-1">
        <label htmlFor={`${id}-base`} className="text-sm text-neutral-400">
          Base voice
        </label>
        <select id={`${id}-base`} value={baseVoice} onChange={(e) => onBaseVoice(e.target.value)} disabled={busy} className={`${FIELD} min-h-11`}>
          {GEMINI_VOICES.map((v) => (
            <option key={v.name} value={v.name}>
              {`${v.name} · ${v.character} · ${v.gender}`}
            </option>
          ))}
        </select>
      </div>
      <div className="flex flex-col gap-1">
        <label htmlFor={`${id}-description`} className="text-sm text-neutral-400">
          Description
        </label>
        <textarea
          id={`${id}-description`}
          value={description}
          onChange={(e) => onDescription(e.target.value)}
          maxLength={DESCRIPTION_MAX}
          rows={5}
          disabled={busy}
          className={`${FIELD} resize-none`}
        />
      </div>
      {voice.warning && <p className="text-sm text-amber-400">{voice.warning}</p>}
      <div className="flex flex-col gap-1">
        <p className="text-sm text-neutral-400">Sample ({languageName(voice.sampleLanguage)})</p>
        {voice.hasSample ? (
          <audio controls src={sampleUrl(slug, voice.updatedAt)} className="w-full" />
        ) : (
          <p className="text-sm text-neutral-500">No sample yet. Try again to hear this voice.</p>
        )}
      </div>
      {error && (
        <p role="alert" className="text-sm text-red-300">
          {error}
        </p>
      )}
      <div className="flex flex-wrap justify-end gap-1.5 sm:gap-2">
        <button type="button" onClick={onTurnOff} disabled={busy} className={`${BUTTON} text-red-400 hover:bg-red-500/15`}>
          Turn voice off
        </button>
        <button type="button" onClick={onTryAgain} disabled={busy} aria-busy={busy} className={`${BUTTON} border border-white/15 text-neutral-200 hover:bg-white/10`}>
          Try again
        </button>
        <button
          type="button"
          onClick={onApprove}
          disabled={busy || !voice.hasSample || dirty}
          className={`${BUTTON} bg-neutral-100 font-medium text-neutral-900 hover:bg-white disabled:hover:bg-neutral-100`}
        >
          Approve
        </button>
      </div>
    </div>
  );
}

type VoicePanelProps = {
  persona: { id: string; name: string };
  open: boolean;
  onClose: () => void;
  /** After any change: the voice's status (null once removed) and the languages testers can now use (empty unless approved). */
  onChanged: (v: { status: VoiceStatus | null; voiceLanguages: string[] }) => void;
};

type Load = { kind: "loading" } | { kind: "creating" } | { kind: "none" } | { kind: "ready"; voice: VoiceDto };

/**
 * Spec §33.3: the admin designs, tries and approves a persona's voice. A bottom sheet on a phone, a
 * centred dialog from sm: up, on the native <dialog>. Mount it fresh for each opening: it loads the
 * voice (and drafts one if the persona has none) when it mounts.
 */
export default function VoicePanel({ persona, open, onClose, onChanged }: VoicePanelProps) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const headingId = useId();
  const [load, setLoad] = useState<Load>({ kind: "loading" });
  const [languages, setLanguages] = useState<string[]>([]);
  const [baseVoice, setBaseVoice] = useState("");
  const [description, setDescription] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [confirmingOff, setConfirmingOff] = useState(false);
  // Held in refs so the load effect runs once per mount, not per render.
  const onChangedRef = useRef(onChanged);
  useEffect(() => {
    onChangedRef.current = onChanged;
  });

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;
    if (open && !dialog.open) dialog.showModal();
    if (!open && dialog.open) dialog.close();
  }, [open]);

  function show(voice: VoiceDto, available: string[]) {
    setLoad({ kind: "ready", voice });
    setBaseVoice(voice.baseVoice);
    setDescription(voice.description);
    onChangedRef.current({ status: voice.status, voiceLanguages: voice.status === "approved" ? available : [] });
  }

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    (async () => {
      const state = await fetchVoice(persona.id);
      if (cancelled) return;
      if (!state) return setError("Couldn't load the voice. Close and try again.");
      setLanguages(state.voiceLanguages);
      if (state.voice) return show(state.voice, state.voiceLanguages);
      if (state.voiceLanguages.length === 0) return setLoad({ kind: "none" });
      setLoad({ kind: "creating" });
      const result = await createVoice(persona.id);
      if (cancelled) {
        // Closed mid-draft: the voice exists now, so the picker must hear about it.
        if (result.ok) onChangedRef.current({ status: result.voice.status, voiceLanguages: [] });
        return;
      }
      if (result.ok) show(result.voice, state.voiceLanguages);
      else {
        setLoad({ kind: "none" });
        setError(result.error);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [open, persona.id]);

  async function run(action: () => Promise<VoiceResult>) {
    if (busy) return;
    setBusy(true);
    setError(null);
    const result = await action();
    setBusy(false);
    if (result.ok) show(result.voice, languages);
    else setError(result.error);
  }

  async function turnOff() {
    setConfirmingOff(false);
    setBusy(true);
    setError(null);
    const removed = await removeVoice(persona.id);
    setBusy(false);
    if (!removed) return setError("Couldn't turn the voice off. Try again.");
    onChanged({ status: null, voiceLanguages: [] });
    onClose();
  }

  return (
    <>
      <dialog
        ref={dialogRef}
        aria-labelledby={headingId}
        onClose={onClose}
        onClick={(event) => {
          if (event.target === event.currentTarget) onClose();
        }}
        className="mx-0 mt-auto mb-0 max-h-[90dvh] w-full max-w-full overflow-y-auto rounded-t-3xl border border-white/10 bg-neutral-900 p-0 text-foreground shadow-lg shadow-black/40 backdrop:bg-black/60 pointer-fine:backdrop:backdrop-blur-sm sm:m-auto sm:w-[calc(100%-2rem)] sm:max-w-md sm:rounded-3xl"
      >
        <div className="flex flex-col gap-4 p-4 pb-[max(1rem,env(safe-area-inset-bottom))] sm:p-5">
          <div className="flex items-start gap-2">
            <h2 id={headingId} className="flex-1 pt-2.5 text-sm font-medium">
              Voice for {persona.name}
            </h2>
            <button
              type="button"
              aria-label="Close"
              onClick={onClose}
              className="-mt-1 -mr-2 inline-flex size-11 shrink-0 items-center justify-center rounded-full text-neutral-400 transition-colors hover:bg-white/10 hover:text-foreground focus-visible:outline focus-visible:outline-white/40"
            >
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" className="size-5" aria-hidden="true">
                <path d="M6 6l12 12M18 6L6 18" />
              </svg>
            </button>
          </div>
          {load.kind === "loading" && !error && <p role="status" className="text-sm text-neutral-400">Loading…</p>}
          {load.kind === "creating" && (
            <p role="status" className="text-sm text-neutral-400">
              Designing a voice…
            </p>
          )}
          {load.kind === "none" && !error && <p className="text-sm text-neutral-400">This persona spoke no language the voice can use.</p>}
          {load.kind === "ready" && (
            <VoiceForm
              slug={persona.id}
              voice={load.voice}
              baseVoice={baseVoice}
              description={description}
              busy={busy}
              error={error}
              onBaseVoice={setBaseVoice}
              onDescription={setDescription}
              onTryAgain={() => void run(() => saveVoice(persona.id, { baseVoice, description, render: true }))}
              onApprove={() => void run(() => approveVoice(persona.id))}
              onTurnOff={() => setConfirmingOff(true)}
            />
          )}
          {load.kind !== "ready" && error && (
            <p role="alert" className="text-sm text-red-300">
              {error}
            </p>
          )}
        </div>
      </dialog>
      <ConfirmDialog
        open={confirmingOff}
        title={`Turn off the voice for ${persona.name}?`}
        message="Testers will no longer be offered voice conversations with this persona."
        confirmLabel="Turn off"
        onConfirm={() => void turnOff()}
        onCancel={() => setConfirmingOff(false)}
      />
    </>
  );
}
