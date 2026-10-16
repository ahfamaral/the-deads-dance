"use client";

import { useEffect, useId, useRef, useState } from "react";
import { languageName } from "@corpus/languages";
import { getAudioContext } from "@/lib/audio-player";
import type { Persona } from "@/lib/personas";

export type StartChoice = { mode: "text" } | { mode: "voice"; language: string };

type VoiceStartDialogProps = {
  persona: Persona;
  /** The pill pressed at first: the browser's language if on the list, else the native one. */
  defaultLanguage: string;
  onStart: (choice: StartChoice) => void;
  /** ✕, Escape or the backdrop: back to the picker without starting. */
  onCancel: () => void;
};

/**
 * Spec §33.4: Text or Voice, asked before a visit with a persona that has a voice. Built on the
 * native <dialog> like RatingSheet. Voice is preselected; the language pills apply to Voice only.
 */
export default function VoiceStartDialog({ persona, defaultLanguage, onStart, onCancel }: VoiceStartDialogProps) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const headingId = useId();
  const group = useId();
  const [mode, setMode] = useState<"text" | "voice">("voice");
  const [language, setLanguage] = useState(defaultLanguage);

  useEffect(() => {
    const dialog = dialogRef.current;
    if (dialog && !dialog.open) dialog.showModal();
  }, []);

  function start() {
    if (mode === "voice") {
      // Inside the tap: unlocks audio playback on iOS.
      void getAudioContext()?.resume().catch(() => {});
      onStart({ mode: "voice", language });
    } else onStart({ mode: "text" });
  }

  const option = (value: "text" | "voice", title: string, note: string) => (
    <label className="flex min-h-11 cursor-pointer items-center gap-3 rounded-2xl px-2 has-[:focus-visible]:outline has-[:focus-visible]:outline-white/40">
      <input type="radio" name={group} value={value} checked={mode === value} onChange={() => setMode(value)} className="size-4 accent-neutral-100" />
      <span className="flex flex-col">
        <span className="text-sm font-medium">{title}</span>
        <span className="text-sm text-neutral-500">{note}</span>
      </span>
    </label>
  );

  return (
    <dialog
      ref={dialogRef}
      aria-labelledby={headingId}
      // Escape closes the dialog, which counts as Cancel.
      onClose={onCancel}
      onClick={(event) => {
        if (event.target === event.currentTarget) onCancel();
      }}
      className="m-auto w-[calc(100%-2rem)] max-w-sm rounded-3xl border border-white/10 bg-neutral-900 p-0 text-foreground shadow-lg shadow-black/40 backdrop:bg-black/60 pointer-fine:backdrop:backdrop-blur-sm"
    >
      <div className="flex flex-col gap-3 p-4 sm:p-5">
        <div className="flex items-start gap-2">
          <h2 id={headingId} className="flex-1 pt-2.5 text-sm font-medium">
            How would you like to talk to {persona.name}?
          </h2>
          <button
            type="button"
            aria-label="Close"
            onClick={onCancel}
            className="-mt-1 -mr-2 inline-flex size-11 shrink-0 items-center justify-center rounded-full text-neutral-400 transition-colors hover:bg-white/10 hover:text-foreground focus-visible:outline focus-visible:outline-white/40"
          >
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" className="size-5" aria-hidden="true">
              <path d="M6 6l12 12M18 6L6 18" />
            </svg>
          </button>
        </div>
        <div role="radiogroup" className="flex flex-col gap-1">
          {option("text", "Text", "As today")}
          {option("voice", "Voice", "Each answer uses more energy")}
        </div>
        {mode === "voice" && (
          <div className="flex flex-wrap gap-2 pl-9">
            {persona.voiceLanguages.map((code) => (
              <button
                key={code}
                type="button"
                aria-pressed={code === language}
                onClick={() => setLanguage(code)}
                className={`min-h-11 rounded-full border px-4 text-sm transition-colors focus-visible:outline focus-visible:outline-white/40 ${
                  code === language ? "border-white/60 bg-white/15 text-foreground" : "border-white/15 text-neutral-400 hover:bg-white/10"
                }`}
              >
                {languageName(code)}
              </button>
            ))}
          </div>
        )}
        <button
          type="button"
          onClick={start}
          className="mt-1 min-h-11 rounded-full bg-neutral-100 px-4 py-1.5 text-sm font-medium text-neutral-900 transition-colors hover:bg-white"
        >
          Start
        </button>
      </div>
    </dialog>
  );
}
