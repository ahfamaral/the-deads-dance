import { Fragment, useEffect, useRef, type ReactNode } from "react";
import PersonaMessage from "@/components/persona-message";
import { voiceMarker } from "@/lib/conversation-types";
import type { LanguageMode, Message } from "@/lib/chat-types";
import { languageModeNotes } from "@/lib/language-mode";

type ConversationProps = {
  personaName: string;
  /** Spec §27: whose conversation this is, when the admin opens someone else's. */
  ownerEmail?: string;
  messages: Message[];
  onBack: () => void;
  /** The persona reply that is still streaming. */
  pending?: Message;
  /** Why the last turn failed; shown inline under the conversation. */
  turnError?: { reason: string } | null;
  /** Shown as a Retry button on the error, when the failure is retryable. */
  onRetry?: () => void;
  /** Spec §9: the MCP server is down, so answers aren't grounded. */
  toolsUnavailable?: boolean;
  /** Spec §18.4: the "Always answer in my language" switch. Left out of a record from History, which can't be continued. */
  languageMode?: LanguageMode;
  onLanguageModeChange?: (mode: LanguageMode) => void;
  /** The header's right cell: the energy bar, or the admin's spend badge. */
  meterSlot?: ReactNode;
  /** Shown under the tools banner (the energy notice). */
  notice?: ReactNode;
  /** Spec §26.4: the server is still writing the reply; shows "Still replying…". */
  waiting?: boolean;
  /** Admin only: each reply shows its cost line. */
  showCost?: boolean;
  /** Spec §33.4: the voice screen, in place of the message list. */
  stage?: ReactNode;
  /** Spec §33.6: a record of a voice conversation, marked above its messages; the transcript stays as text. */
  voiceLanguage?: string;
};

/** Transcript of the exchange between the user and the persona, including the reply that is still streaming. */
export default function Conversation({
  personaName,
  ownerEmail,
  messages,
  onBack,
  pending,
  turnError,
  onRetry,
  toolsUnavailable = false,
  languageMode,
  onLanguageModeChange,
  meterSlot,
  notice,
  waiting = false,
  showCost = false,
  stage,
  voiceLanguage,
}: ConversationProps) {
  const endRef = useRef<HTMLDivElement>(null);
  // Keep the newest content in view as the reply streams in.
  useEffect(() => {
    endRef.current?.scrollIntoView({ block: "end" });
  }, [messages.length, pending?.text, pending?.toolCalls?.length, turnError, waiting]);
  const empty = messages.length === 0 && !pending && !turnError && !waiting;
  const notes = languageModeNotes(messages);
  return (
    <section
      aria-label={`Conversation with ${personaName}`}
      className="flex min-h-0 w-full flex-1 flex-col rounded-3xl border border-white/10 bg-neutral-900/80 shadow-lg shadow-black/40 pointer-coarse:bg-neutral-900/90 pointer-fine:backdrop-blur-md"
    >
      <header className="grid grid-cols-[1fr_minmax(0,auto)_1fr] items-center gap-3 border-b border-white/10 p-3">
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
        <div className="flex min-w-0 flex-col items-center">
          {/* On phones the voice stage shows the name above the orb instead. */}
          <h2 className={`min-w-0 max-w-full truncate text-sm font-medium text-foreground ${stage ? "max-sm:hidden" : ""}`}>{personaName}</h2>
          {ownerEmail && <p className="max-w-full truncate text-xs text-neutral-400">{ownerEmail}</p>}
        </div>
        {/* The right cell also keeps the name centred (spec §26.5). */}
        <div className="flex justify-self-end">{meterSlot}</div>
      </header>
      {onLanguageModeChange && (
        <div className="flex justify-end border-b border-white/10 px-4 py-1.5">
          <label className="flex cursor-pointer items-center gap-2 text-xs text-neutral-400">
            <input
              type="checkbox"
              checked={languageMode === "visitor"}
              onChange={(event) => onLanguageModeChange(event.target.checked ? "visitor" : "realistic")}
              className="accent-neutral-300"
            />
            Always answer in my language
          </label>
        </div>
      )}
      {toolsUnavailable && (
        <p role="status" className="border-b border-white/10 bg-amber-500/10 px-4 py-2 text-center text-xs text-amber-200">
          Biography tools unavailable: answers won&apos;t be grounded.
        </p>
      )}
      {notice}
      {stage ?? (
      <div className="relative flex min-h-0 flex-1 flex-col">
        {/* Inner shadow along the top edge; an overlay so messages scroll beneath it rather than over it. */}
        <div aria-hidden="true" className="pointer-events-none absolute inset-x-0 top-0 z-10 h-6 bg-linear-to-b from-black/40 to-transparent" />
        <div className="min-h-0 flex-1 scroll-pb-10 overflow-y-auto px-5 pt-5 pb-10">
          {voiceLanguage && <p className="mb-4 text-center text-xs text-neutral-400">{voiceMarker(voiceLanguage)}</p>}
          {empty ? (
            <p className="flex h-full items-center justify-center text-neutral-500">
              Ask {personaName} anything to begin.
            </p>
          ) : (
            <ol className="flex flex-col gap-5">
              {messages.map((message) =>
                message.role === "user" ? (
                  <Fragment key={message.id}>
                    {notes.has(message.id) && (
                      <li className="text-center text-xs text-neutral-400">Always answer in my language: {notes.get(message.id)}</li>
                    )}
                    <li className="flex justify-end">
                      <p className="max-w-[80%] whitespace-pre-wrap rounded-2xl rounded-br-md bg-white/10 px-4 py-2.5 text-foreground">
                        {message.text}
                      </p>
                    </li>
                  </Fragment>
                ) : (
                  <PersonaMessage key={message.id} personaName={personaName} message={message} showCost={showCost} />
                ),
              )}
              {pending && <PersonaMessage personaName={personaName} message={pending} streaming showCost={showCost} />}
              {waiting && (
                <li role="status" className="animate-pulse text-sm text-neutral-500 motion-reduce:animate-none">
                  Still replying…
                </li>
              )}
              {turnError && (
                <li
                  role="alert"
                  className="flex items-center gap-3 rounded-2xl border border-rose-500/20 bg-rose-500/10 px-4 py-2.5 text-sm text-rose-200"
                >
                  <span className="flex-1">{turnError.reason}</span>
                  {onRetry && (
                    <button
                      type="button"
                      onClick={onRetry}
                      className="min-h-11 rounded-full px-3 py-1 text-base text-rose-100 sm:text-sm transition-colors hover:bg-white/10 focus-visible:outline focus-visible:outline-white/40"
                    >
                      Retry
                    </button>
                  )}
                </li>
              )}
            </ol>
          )}
          <div ref={endRef} />
        </div>
      </div>
      )}
    </section>
  );
}
