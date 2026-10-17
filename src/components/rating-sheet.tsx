"use client";

import { useEffect, useId, useRef, useState } from "react";
import { canSend, COMMENT_MAX, type Feedback } from "@/lib/feedback";

type RatingSheetProps = {
  open: boolean;
  personaName: string;
  /** Spec §32.5: pre-fills the sheet when editing a rating. */
  initial: Feedback | null;
  /** Saves the rating; the saved one, or null when it couldn't be saved. */
  onSave: (feedback: Feedback) => Promise<Feedback | null>;
  onSaved: (feedback: Feedback) => void;
  /** Skip, ✕, Escape or the backdrop: closes without saving. */
  onClose: () => void;
};

const STARS = [1, 2, 3, 4, 5];

/** A click that lands on the <dialog> itself, not its content, is on the backdrop. */
export function isBackdropClick(target: EventTarget | null, dialog: EventTarget): boolean {
  return target === dialog;
}

/** Spec §32.5: saves only a valid rating, comment trimmed. The saved rating, or null (nothing sent, or it failed). */
export async function trySave(
  onSave: (feedback: Feedback) => Promise<Feedback | null>,
  stars: number | null,
  comment: string,
): Promise<Feedback | null> {
  if (stars === null || !canSend(stars, comment)) return null;
  return onSave({ stars, comment: comment.trim() });
}
const BUTTON = "min-h-11 flex-1 whitespace-nowrap rounded-full px-4 py-1.5 text-base sm:flex-none sm:text-sm";

/**
 * Spec §32.5: 1–5 stars and an optional comment for one conversation. A bottom sheet on a phone, a
 * centred dialog from sm: up. Built on the native <dialog> like ConfirmDialog (focus trap, Escape).
 * Its state starts from `initial`, so mount it fresh for each opening.
 */
export default function RatingSheet({ open, personaName, initial, onSave, onSaved, onClose }: RatingSheetProps) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const headingId = useId();
  const group = useId();
  const [stars, setStars] = useState<number | null>(initial?.stars ?? null);
  const [comment, setComment] = useState(initial?.comment ?? "");
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;
    if (open && !dialog.open) dialog.showModal();
    if (!open && dialog.open) dialog.close();
  }, [open]);

  async function send() {
    if (!canSend(stars, comment) || busy) return;
    setBusy(true);
    setFailed(false);
    const saved = await trySave(onSave, stars, comment);
    setBusy(false);
    if (saved) onSaved(saved);
    else setFailed(true);
  }

  return (
    <dialog
      ref={dialogRef}
      aria-labelledby={headingId}
      // Escape closes the dialog, which counts as Skip.
      onClose={onClose}
      onClick={(event) => {
        if (isBackdropClick(event.target, event.currentTarget)) onClose();
      }}
      className="mx-0 mt-auto mb-0 w-full max-w-full rounded-t-3xl border border-white/10 bg-neutral-900 p-0 text-foreground shadow-lg shadow-black/40 backdrop:bg-black/60 pointer-fine:backdrop:backdrop-blur-sm sm:m-auto sm:w-[calc(100%-2rem)] sm:max-w-sm sm:rounded-3xl"
    >
      <div className="flex flex-col gap-4 p-4 pb-[max(1rem,env(safe-area-inset-bottom))] sm:p-5">
        <div className="flex items-start gap-2">
          <h2 id={headingId} className="flex-1 pt-2.5 text-sm font-medium">
            How was your visit with {personaName}?
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
        <fieldset className="flex justify-center gap-1">
          <legend className="sr-only">Rating</legend>
          {STARS.map((n) => {
            const filled = stars !== null && n <= stars;
            return (
              <label
                key={n}
                className="inline-flex size-11 cursor-pointer items-center justify-center rounded-full text-3xl has-[:focus-visible]:outline has-[:focus-visible]:outline-white/40"
              >
                <input
                  type="radio"
                  name={group}
                  value={n}
                  checked={stars === n}
                  onChange={() => setStars(n)}
                  aria-label={`${n} of 5 stars`}
                  className="sr-only"
                />
                <span aria-hidden="true" className={filled ? "text-amber-400" : "text-neutral-500"}>
                  {filled ? "★" : "☆"}
                </span>
              </label>
            );
          })}
        </fieldset>
        <textarea
          value={comment}
          onChange={(event) => setComment(event.target.value)}
          maxLength={COMMENT_MAX}
          rows={3}
          placeholder="Anything to add? (optional)"
          aria-label="Comment"
          className="w-full resize-none rounded-2xl border border-white/10 bg-neutral-950/60 px-3 py-2 text-base text-foreground placeholder:text-neutral-500 focus-visible:outline focus-visible:outline-white/40 sm:text-sm"
        />
        {failed && (
          <p role="alert" className="text-sm text-red-300">
            Couldn&apos;t save your rating. Try again.
          </p>
        )}
        <div className="flex justify-end gap-1.5 sm:gap-2">
          {/* Editing from History has no Skip (2026-10-16); ✕ still closes. */}
          {!initial && (
            <button type="button" onClick={onClose} className={`${BUTTON} text-neutral-400 transition-colors hover:bg-white/10 hover:text-foreground`}>
              Skip
            </button>
          )}
          <button
            type="button"
            onClick={() => void send()}
            disabled={!canSend(stars, comment) || busy}
            aria-busy={busy}
            className={`${BUTTON} bg-neutral-100 font-medium text-neutral-900 transition-colors hover:bg-white disabled:opacity-40 disabled:hover:bg-neutral-100`}
          >
            {initial ? "Save" : "Send"}
          </button>
        </div>
      </div>
    </dialog>
  );
}
