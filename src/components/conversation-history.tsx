"use client";

import { useEffect, useState } from "react";
import ConfirmDialog from "@/components/confirm-dialog";
import ExportDialog from "@/components/export-dialog";
import VoiceIcon from "@/components/voice-icon";
import { canDelete, ownerLine, type ConversationSummary, type StoredConversation } from "@/lib/conversation-types";
import { fetchConversation, fetchConversationList, removeConversation } from "@/lib/conversations-api";
import { starsText } from "@/lib/feedback";
import { ensureAccess } from "@/lib/ensure-access";
import { useScrollFade } from "@/lib/use-scroll-fade";

type ConversationHistoryProps = {
  onBack: () => void;
  onOpen: (conversation: StoredConversation) => void;
};

const updatedAtFormat = new Intl.DateTimeFormat(undefined, {
  dateStyle: "medium",
  timeStyle: "short",
});

/** A row's first line: the persona's name, the voice icon of a voice conversation (spec §33.6), and the stars. */
export function HistoryRowHead({ conversation }: { conversation: ConversationSummary }) {
  return (
    <span className="flex max-w-full items-baseline gap-2">
      <span className="min-w-0 truncate font-medium text-foreground">
        {conversation.personaName}
      </span>
      {conversation.voiceLanguage && (
        <span className="-ml-2 shrink-0">
          <VoiceIcon label="Voice conversation" />
        </span>
      )}
      {conversation.stars !== null && (
        <span className="shrink-0 text-sm text-amber-400">
          <span className="sr-only">Rated {conversation.stars} of 5</span>
          <span aria-hidden="true">{starsText(conversation.stars)}</span>
        </span>
      )}
    </span>
  );
}

/**
 * Spec §25.4: your conversations, newest first, from the server. Spec §27: the admin sees everyone's, with the
 * owner under the persona; Delete only on their own. Open and Export load the full
 * conversation first; Delete asks, then removes it on the server for good.
 */
export default function ConversationHistory({ onBack, onOpen }: ConversationHistoryProps) {
  const [conversations, setConversations] = useState<ConversationSummary[] | null>(null);
  const [loadFailed, setLoadFailed] = useState(false);
  const [note, setNote] = useState<string | null>(null);
  const [exporting, setExporting] = useState<StoredConversation | null>(null);
  const [deleting, setDeleting] = useState<ConversationSummary | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const listFade = useScrollFade();

  useEffect(() => {
    void fetchConversationList().then((list) => (list ? setConversations(list) : setLoadFailed(true)));
  }, []);

  /** Loads the full conversation for Open or Export; a failure leaves a note and the row. */
  async function withFull(summary: ConversationSummary, onLoaded: (c: StoredConversation) => void) {
    setNote(null);
    const result = await fetchConversation(summary.id);
    if (result.kind === "found") onLoaded(result.conversation);
    else if (result.kind === "missing") {
      setConversations((current) => current?.filter((c) => c.id !== summary.id) ?? null);
      setNote("That conversation is no longer available.");
    } else setNote("Couldn't open the conversation. Try again in a minute.");
  }

  async function confirmDelete() {
    const target = deleting;
    setDeleting(null);
    if (!target) return;
    setNote(null);
    if (await removeConversation(target.id)) {
      setConversations((current) => current?.filter((c) => c.id !== target.id) ?? null);
    } else setNote("Couldn't delete the conversation. Try again in a minute.");
  }

  return (
    <div className="flex min-h-0 flex-1 items-center justify-center">
      <section
        aria-labelledby="conversation-history-heading"
        className="flex max-h-full w-full max-w-md flex-col overflow-hidden rounded-3xl border border-white/10 bg-neutral-900/80 shadow-lg shadow-black/40 pointer-coarse:bg-neutral-900/90 pointer-fine:backdrop-blur-md"
      >
        <header className="grid grid-cols-[1fr_auto_1fr] items-center gap-3 border-b border-white/10 p-3">
          <button
            type="button"
            onClick={onBack}
            className="flex items-center justify-self-start gap-1.5 min-h-11 rounded-full px-3 py-1.5 text-base text-neutral-400 sm:text-sm transition-colors hover:bg-white/10 hover:text-foreground focus-visible:outline focus-visible:outline-white/40"
          >
            <svg
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth={2}
              strokeLinecap="round"
              strokeLinejoin="round"
              className="size-4"
              aria-hidden="true"
            >
              <path d="M15 18l-6-6 6-6" />
            </svg>
            Back
          </button>
          <h2
            id="conversation-history-heading"
            className="truncate text-sm font-medium text-foreground"
          >
            History of conversations
          </h2>
        </header>
        {note && (
          <p role="status" className="border-b border-white/10 px-5 py-2 text-sm text-neutral-400">
            {note}
          </p>
        )}
        {conversations === null ? (
          <p className="px-5 py-10 text-center text-sm text-neutral-500">
            {loadFailed ? "Couldn't load your conversations." : "Loading…"}
          </p>
        ) : conversations.length === 0 ? (
          <p className="px-5 py-10 text-center text-sm text-neutral-500">No conversations yet.</p>
        ) : (
          <ul {...listFade} className="scroll-fade flex min-h-0 flex-col gap-2 overflow-y-auto p-3">
            {conversations.map((conversation) => {
              const firstLine = conversation.preview;
              const selected = conversation.id === selectedId;
              return (
                <li
                  key={conversation.id}
                  // The keyboard focus ring sits on the card, not on the inner row button (a second border inside the card).
                  className={`flex items-center rounded-2xl border transition-colors has-[>button:focus-visible]:outline has-[>button:focus-visible]:outline-white/40 ${selected
                      ? "border-white/25 bg-white/10"
                      : "border-white/5 bg-white/5 hover:border-white/20 hover:bg-white/10"
                    }`}
                >
                  <button
                    type="button"
                    aria-pressed={selected}
                    onClick={() => setSelectedId(conversation.id)}
                    className="flex min-w-0 flex-1 flex-col items-start gap-0.5 self-stretch rounded-2xl px-4 py-3 text-left outline-none"
                  >
                    <HistoryRowHead conversation={conversation} />
                    {ownerLine(conversation) && (
                      <span className="max-w-full truncate text-xs text-neutral-400">{ownerLine(conversation)}</span>
                    )}
                    {/* max-w-full: in an items-start column a line is as wide as its text, so truncate needs a cap to cut it with "…". */}
                    <span className="max-w-full truncate text-sm text-neutral-500">
                      {firstLine ?? "No messages"}
                    </span>
                    <time dateTime={conversation.updatedAt} className="text-xs text-neutral-500">
                      {updatedAtFormat.format(new Date(conversation.updatedAt))}
                    </time>
                  </button>
                  {/* Fixed-width slot reserved on every row, as in the persona
                      picker, so revealing the buttons never reflows the text.
                      They show only on the selected row; elsewhere they are
                      inert, so hidden buttons can't be tabbed to or clicked. */}
                  <div
                    inert={!selected}
                    className={`flex w-24 shrink-0 flex-col items-stretch gap-1.5 py-3 pr-3 transition-[opacity,translate] duration-300 ease-out motion-reduce:transition-none ${selected ? "translate-x-0 opacity-100" : "translate-x-3 opacity-0"
                      }`}
                  >
                    <button
                      type="button"
                      onClick={() => {
                        void withFull(conversation, setExporting);
                        void ensureAccess(); // the dialog isn't a screen change, so it checks here
                      }}
                      aria-label={`Export conversation with ${conversation.personaName}`}
                      className="min-h-11 w-full whitespace-nowrap rounded-full bg-neutral-200 px-3 py-1.5 text-base font-medium sm:min-h-0 sm:text-sm text-neutral-900 transition-[background-color,box-shadow] duration-200 ease-out hover:bg-white hover:shadow-[0_0_16px_rgba(255,255,255,0.35)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white/60"
                    >
                      Export
                    </button>
                    <button
                      type="button"
                      onClick={() => void withFull(conversation, onOpen)}
                      aria-label={`Open conversation with ${conversation.personaName}`}
                      className="min-h-11 w-full whitespace-nowrap rounded-full border border-white/15 px-3 py-1.5 text-base font-medium sm:min-h-0 sm:text-sm text-neutral-200 transition-colors hover:border-white/40 hover:bg-white/10 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white/60"
                    >
                      Open
                    </button>
                    {canDelete(conversation) && (
                    <button
                      type="button"
                      onClick={() => setDeleting(conversation)}
                      aria-label={`Delete conversation with ${conversation.personaName}`}
                      className="flex min-h-11 w-full items-center justify-center rounded-full border border-white/15 px-3 py-1.5 text-red-500 sm:min-h-0 transition-colors hover:border-red-500/40 hover:bg-red-500/15 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-red-500/60"
                    >
                      {/* size-5 matches the text's 20px line height, so this
                          button is the same height as Export and Open. */}
                      <svg
                        viewBox="0 0 24 24"
                        fill="none"
                        stroke="currentColor"
                        strokeWidth={2}
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        className="size-5"
                        aria-hidden="true"
                      >
                        <path d="M3 6h18M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6M10 11v6M14 11v6" />
                      </svg>
                    </button>
                    )}
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </section>
      <ExportDialog conversation={exporting} onClose={() => setExporting(null)} />
      <ConfirmDialog
        open={deleting !== null}
        title="Delete this conversation?"
        message="This can't be undone."
        confirmLabel="Delete"
        onConfirm={() => void confirmDelete()}
        onCancel={() => setDeleting(null)}
      />
    </div>
  );
}
