"use client";

import { useEffect, useRef } from "react";

type ConfirmDialogProps = {
  /** The dialog is open while this is true. */
  open: boolean;
  title: string;
  message: string;
  onConfirm: () => void;
  onCancel: () => void;
};

/**
 * Modal asking the user to confirm or cancel an action. Built on the native
 * <dialog>, like the export dialog, which provides the focus trap and closing on Escape.
 */
export default function ConfirmDialog({ open, title, message, onConfirm, onCancel }: ConfirmDialogProps) {
  const dialogRef = useRef<HTMLDialogElement>(null);

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;
    if (open && !dialog.open) dialog.showModal();
    if (!open && dialog.open) dialog.close();
  }, [open]);

  return (
    <dialog
      ref={dialogRef}
      aria-labelledby="confirm-dialog-heading"
      aria-describedby="confirm-dialog-message"
      // Escape closes the dialog, which counts as Cancel.
      onClose={onCancel}
      // A click that lands on the <dialog> itself, not its content, is on the backdrop.
      onClick={(event) => {
        if (event.target === event.currentTarget) onCancel();
      }}
      className="m-auto w-[calc(100%-2rem)] max-w-sm rounded-3xl border border-white/10 bg-neutral-900 p-0 text-foreground shadow-lg shadow-black/40 backdrop:bg-black/60 backdrop:backdrop-blur-sm"
    >
      <div className="flex flex-col gap-4 p-5">
        <div className="flex flex-col gap-1">
          <h2 id="confirm-dialog-heading" className="text-sm font-medium">
            {title}
          </h2>
          <p id="confirm-dialog-message" className="text-sm text-neutral-500">
            {message}
          </p>
        </div>
        <div className="flex justify-end gap-2">
          <button
            type="button"
            onClick={onCancel}
            className="rounded-full px-4 py-1.5 text-sm text-neutral-400 transition-colors hover:bg-white/10 hover:text-foreground focus-visible:outline focus-visible:outline-white/40"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={onConfirm}
            className="rounded-full bg-neutral-100 px-4 py-1.5 text-sm font-medium text-neutral-900 transition-colors hover:bg-white focus-visible:outline focus-visible:outline-white/40"
          >
            Confirm
          </button>
        </div>
      </div>
    </dialog>
  );
}
