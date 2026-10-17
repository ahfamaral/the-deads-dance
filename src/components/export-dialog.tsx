"use client";

import { useEffect, useRef, useState } from "react";
import { EXPORT_FORMATS, exportConversation, type ExportFormat } from "@/lib/conversation-export";
import type { StoredConversation } from "@/lib/conversation-types";

type ExportDialogProps = {
  /** The conversation to export; the dialog is open while this is set. */
  conversation: StoredConversation | null;
  onClose: () => void;
};

/**
 * Modal asking which format to export a conversation in. Built on the
 * native <dialog>, which provides the focus trap and closing on Escape.
 */
export default function ExportDialog({ conversation, onClose }: ExportDialogProps) {
  const dialogRef = useRef<HTMLDialogElement>(null);

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;
    if (conversation && !dialog.open) dialog.showModal();
    if (!conversation && dialog.open) dialog.close();
  }, [conversation]);

  return (
    <dialog
      ref={dialogRef}
      aria-labelledby="export-dialog-heading"
      onClose={onClose}
      // A click that lands on the <dialog> itself, not its content, is on the backdrop.
      onClick={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
      className="m-auto w-[calc(100%-2rem)] max-w-sm rounded-3xl border border-white/10 bg-neutral-900 p-0 text-foreground shadow-lg shadow-black/40 backdrop:bg-black/60 pointer-fine:backdrop:backdrop-blur-sm"
    >
      {/* Keyed so a new conversation starts without the previous one's error. */}
      {conversation && <ExportOptions key={conversation.id} conversation={conversation} onClose={onClose} />}
    </dialog>
  );
}

/** Spec §21.4: the PDF can fail to load; the dialog then stays open and says so. */
function ExportOptions({ conversation, onClose }: { conversation: StoredConversation; onClose: () => void }) {
  const [busy, setBusy] = useState<ExportFormat | null>(null);
  const [failed, setFailed] = useState(false);

  async function choose(format: ExportFormat) {
    setBusy(format);
    setFailed(false);
    try {
      await exportConversation(conversation, format);
      onClose();
    } catch (error) {
      console.error("Export failed", error);
      setFailed(true);
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="flex flex-col gap-4 p-5">
      <div className="flex flex-col gap-1">
        <h2 id="export-dialog-heading" className="text-sm font-medium">
          Export conversation
        </h2>
        <p className="text-sm text-neutral-500">
          In which format would you like to export your conversation with{" "}
          {conversation.personaName}?
        </p>
      </div>
      <ul className="flex flex-col gap-2">
        {EXPORT_FORMATS.map(({ format, label, description }) => (
          <li key={format}>
            <button
              type="button"
              disabled={busy !== null}
              aria-busy={busy === format}
              onClick={() => void choose(format)}
              className="flex w-full items-baseline justify-between gap-3 rounded-2xl border border-white/5 bg-white/5 px-4 py-3 text-left transition-colors hover:border-white/20 hover:bg-white/10 focus-visible:outline focus-visible:outline-white/40 disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:border-white/5 disabled:hover:bg-white/5"
            >
              <span className="font-medium">{label}</span>
              <span className="text-xs text-neutral-500">{busy === format ? "Preparing…" : description}</span>
            </button>
          </li>
        ))}
      </ul>
      {failed && (
        <p role="alert" className="text-sm text-amber-300/80">
          Couldn&apos;t create the PDF. JSON and Markdown still work.
        </p>
      )}
      <button
        type="button"
        onClick={onClose}
        className="self-end min-h-11 rounded-full px-3 py-1.5 text-base sm:text-sm text-neutral-400 transition-colors hover:bg-white/10 hover:text-foreground focus-visible:outline focus-visible:outline-white/40"
      >
        Cancel
      </button>
    </div>
  );
}
