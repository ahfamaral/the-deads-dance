import { useEffect, useRef } from "react";
import PersonaMessage from "@/components/persona-message";
import type { LanguageMode, Message } from "@/lib/chat-types";

type ConversationProps = {
  personaName: string;
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
  /** Spec §18.4: the "Always answer in my language" switch. */
  languageMode: LanguageMode;
  onLanguageModeChange: (mode: LanguageMode) => void;
};

/** Transcript of the exchange between the user and the persona, including the reply that is still streaming. */
export default function Conversation({
  personaName,
  messages,
  onBack,
  pending,
  turnError,
  onRetry,
  toolsUnavailable = false,
  languageMode,
  onLanguageModeChange,
}: ConversationProps) {
  const endRef = useRef<HTMLDivElement>(null);
  // Keep the newest content in view as the reply streams in.
  useEffect(() => {
    endRef.current?.scrollIntoView({ block: "end" });
  }, [messages.length, pending?.text, pending?.toolCalls?.length, turnError]);
  const empty = messages.length === 0 && !pending && !turnError;
  return (
    <section
      aria-label={`Conversation with ${personaName}`}
      className="flex min-h-0 w-full flex-1 flex-col rounded-3xl border border-white/10 bg-neutral-900/80 shadow-lg shadow-black/40 backdrop-blur-md"
    >
      <header className="grid grid-cols-[1fr_auto_1fr] items-center gap-3 border-b border-white/10 p-3">
        <button
          type="button"
          onClick={onBack}
          className="flex items-center justify-self-start gap-1.5 rounded-full px-3 py-1.5 text-sm text-neutral-400 transition-colors hover:bg-white/10 hover:text-foreground focus-visible:outline focus-visible:outline-white/40"
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
        <h2 className="truncate text-sm font-medium text-foreground">{personaName}</h2>
        {/* Keeps the name centred now that Save is gone (spec §25.5). */}
        <span aria-hidden="true" />
      </header>
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
      {toolsUnavailable && (
        <p role="status" className="border-b border-white/10 bg-amber-500/10 px-4 py-2 text-center text-xs text-amber-200">
          Biography tools unavailable: answers won&apos;t be grounded.
        </p>
      )}
      <div className="relative flex min-h-0 flex-1 flex-col">
        {/* Inner shadow along the top edge; an overlay so messages scroll beneath it rather than over it. */}
        <div aria-hidden="true" className="pointer-events-none absolute inset-x-0 top-0 z-10 h-6 bg-linear-to-b from-black/40 to-transparent" />
        <div className="min-h-0 flex-1 scroll-pb-10 overflow-y-auto px-5 pt-5 pb-10">
          {empty ? (
            <p className="flex h-full items-center justify-center text-neutral-500">
              Ask {personaName} anything to begin.
            </p>
          ) : (
            <ol className="flex flex-col gap-5">
              {messages.map((message) =>
                message.role === "user" ? (
                  <li key={message.id} className="flex justify-end">
                    <p className="max-w-[80%] whitespace-pre-wrap rounded-2xl rounded-br-md bg-white/10 px-4 py-2.5 text-foreground">
                      {message.text}
                    </p>
                  </li>
                ) : (
                  <PersonaMessage key={message.id} personaName={personaName} message={message} />
                ),
              )}
              {pending && <PersonaMessage personaName={personaName} message={pending} streaming />}
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
                      className="rounded-full px-3 py-1 text-rose-100 transition-colors hover:bg-white/10 focus-visible:outline focus-visible:outline-white/40"
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
    </section>
  );
}
