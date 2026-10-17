"use client";

import { useEffect, useId, useRef, useState } from "react";
import { addEnergyPreview } from "@/lib/admin-spend";
import { parseGrant } from "@/lib/money";

type Props = { open: boolean; email: string; balance: number; defaultAmount: string; onAdd: (amount: string) => void; onCancel: () => void };

/** Spec §26.6: Add energy, $0.01–$5.00, filled with the starting energy, with a preview. */
export default function AddEnergyDialog({ open, email, balance, defaultAmount, onAdd, onCancel }: Props) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const headingId = useId();
  const inputId = useId();
  const [amount, setAmount] = useState(defaultAmount);
  const micros = parseGrant(amount);

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;
    if (open && !dialog.open) {
      setAmount(defaultAmount); // reset on each opening
      dialog.showModal();
    }
    if (!open && dialog.open) dialog.close();
  }, [open, defaultAmount]);

  return (
    <dialog
      ref={dialogRef}
      aria-labelledby={headingId}
      onClose={onCancel}
      onClick={(event) => {
        if (event.target === event.currentTarget) onCancel();
      }}
      className="m-auto w-[calc(100%-2rem)] max-w-sm rounded-3xl border border-white/10 bg-neutral-900 p-0 text-foreground shadow-lg shadow-black/40 backdrop:bg-black/60 pointer-fine:backdrop:backdrop-blur-sm"
    >
      <form
        className="flex flex-col gap-4 p-4 sm:p-5"
        onSubmit={(event) => {
          event.preventDefault();
          if (micros !== null) onAdd(amount);
        }}
      >
        <h2 id={headingId} className="break-all text-sm font-medium">
          Add energy for {email}
        </h2>
        <div className="flex flex-col gap-1">
          <label htmlFor={inputId} className="flex items-center gap-2 text-sm">
            $
            <input
              id={inputId}
              inputMode="decimal"
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              className="w-24 rounded-xl border border-white/10 bg-neutral-950/60 px-3 py-2 text-base text-foreground focus-visible:border-white/40 focus-visible:outline-none"
            />
            <span className="text-xs text-neutral-500">0.01–5.00</span>
          </label>
          <p className="text-xs text-neutral-500">{micros === null ? "Enter an amount from 0.01 to 5.00." : addEnergyPreview(balance, micros)}</p>
        </div>
        <div className="flex flex-wrap justify-end gap-1.5 sm:gap-2">
          <button
            type="button"
            onClick={onCancel}
            className="min-h-11 flex-1 whitespace-nowrap rounded-full px-1.5 py-1.5 text-base sm:text-sm text-neutral-400 transition-colors hover:bg-white/10 hover:text-foreground focus-visible:outline focus-visible:outline-white/40 sm:flex-none sm:px-4 sm:text-sm"
          >
            Cancel
          </button>
          <button
            type="submit"
            disabled={micros === null}
            className="min-h-11 flex-1 whitespace-nowrap rounded-full bg-neutral-100 px-1.5 py-1.5 text-base sm:text-sm font-medium text-neutral-900 transition-colors hover:bg-white focus-visible:outline focus-visible:outline-white/40 disabled:opacity-40 sm:flex-none sm:px-4 sm:text-sm"
          >
            Add
          </button>
        </div>
      </form>
    </dialog>
  );
}
