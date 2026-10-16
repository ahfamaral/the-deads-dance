"use client";

import { useEffect, useId, useRef } from "react";

type ConfirmDialogProps = {
  /** The dialog is open while this is true. */
  open: boolean;
  title: string;
  message: string;
  onConfirm: () => void;
  onCancel: () => void;
  /** The confirm button's label; "Confirm" when absent. */
  confirmLabel?: string;
};

/**
 * Modal asking the user to confirm or cancel an action. Built on the native
 * <dialog>, like the export dialog, which provides the focus trap and closing on Escape.
 */
export default function ConfirmDialog({
  open,
  title,
  message,
  onConfirm,
  onCancel,
  confirmLabel = "Confirm",
}: ConfirmDialogProps) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  // Unique per instance: a closed <dialog> stays in the DOM, so two dialogs on a page must not share ids.
  const headingId = useId();
  const messageId = useId();

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;
    if (open && !dialog.open) dialog.showModal();
    if (!open && dialog.open) dialog.close();
  }, [open]);

  return (
    <dialog
      ref={dialogRef}
      aria-labelledby={headingId}
      aria-describedby={messageId}
      // Escape closes the dialog, which counts as Cancel.
      onClose={onCancel}
      // A click that lands on the <dialog> itself, not its content, is on the backdrop.
      onClick={(event) => {
        if (event.target === event.currentTarget) onCancel();
      }}
      className="m-auto w-[calc(100%-2rem)] max-w-sm rounded-3xl border border-white/10 bg-neutral-900 p-0 text-foreground shadow-lg shadow-black/40 backdrop:bg-black/60 pointer-fine:backdrop:backdrop-blur-sm"
    >
      <div className="flex flex-col gap-4 p-4 sm:p-5">
        <div className="flex flex-col gap-1">
          <h2 id={headingId} className="text-sm font-medium">
            {title}
          </h2>
          <p id={messageId} className="text-sm text-neutral-500">
            {message}
          </p>
        </div>
        {/* On phones the buttons share one row: same height, no wrapping, smaller text. */}
        <div className="flex justify-end gap-1.5 sm:gap-2">
          <button
            type="button"
            onClick={onCancel}
            className="min-h-11 flex-1 whitespace-nowrap rounded-full px-1.5 py-1.5 text-[length:clamp(10px,2.9vw,12px)] sm:flex-none sm:px-4 sm:text-sm text-neutral-400 transition-colors hover:bg-white/10 hover:text-foreground focus-visible:outline focus-visible:outline-white/40"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={onConfirm}
            className="min-h-11 flex-1 whitespace-nowrap rounded-full bg-neutral-100 px-1.5 py-1.5 text-[length:clamp(10px,2.9vw,12px)] sm:flex-none sm:px-4 sm:text-sm font-medium text-neutral-900 transition-colors hover:bg-white focus-visible:outline focus-visible:outline-white/40"
          >
            {confirmLabel}
          </button>
        </div>
      </div>
    </dialog>
  );
}
