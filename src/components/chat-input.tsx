import { useState, type KeyboardEvent } from "react";
import { MAX_MESSAGE_CHARS } from "@/lib/chat-types";

type ChatInputProps = {
  onSend: (text: string) => void;
  onStop: () => void;
  /** While a reply streams, sending is off and the button stops the reply instead. */
  streaming: boolean;
};

/** The counter appears only as the message nears the limit. */
const COUNTER_FROM = MAX_MESSAGE_CHARS - 500;

/** Message composer. Enter sends, Shift+Enter adds a line. */
export default function ChatInput({ onSend, onStop, streaming }: ChatInputProps) {
  const [text, setText] = useState("");
  const canSend = !streaming && text.trim().length > 0;

  function submit() {
    if (!canSend) return;
    onSend(text.trim());
    setText("");
  }

  function onKeyDown(event: KeyboardEvent<HTMLTextAreaElement>) {
    if (event.key === "Enter" && !event.shiftKey && !event.nativeEvent.isComposing) {
      event.preventDefault();
      submit();
    }
  }

  return (
    <div className="w-full max-w-3xl rounded-3xl border border-white/10 bg-neutral-900/80 p-3 shadow-lg shadow-black/40 backdrop-blur-md focus-within:border-white/20">
      <textarea
        aria-label="Message"
        placeholder="Your message goes here"
        rows={2}
        value={text}
        maxLength={MAX_MESSAGE_CHARS}
        onChange={(event) => setText(event.target.value)}
        onKeyDown={onKeyDown}
        className="field-sizing-content block max-h-60 min-h-12 w-full resize-none bg-transparent px-2 pt-1 text-base text-foreground placeholder:text-neutral-500 focus:outline-none"
      />
      <div className="flex items-center justify-end gap-3">
        {text.length >= COUNTER_FROM && (
          <span className="text-xs tabular-nums text-neutral-500">
            {text.length}/{MAX_MESSAGE_CHARS}
          </span>
        )}
        {streaming ? (
          <button
            type="button"
            aria-label="Stop"
            onClick={onStop}
            className="flex size-9 items-center justify-center rounded-full bg-neutral-100 text-neutral-900 transition-colors hover:bg-white"
          >
            <svg viewBox="0 0 24 24" fill="currentColor" className="size-4" aria-hidden="true">
              <rect x="6" y="6" width="12" height="12" rx="2" />
            </svg>
          </button>
        ) : (
          <button
            type="button"
            aria-label="Send"
            onClick={submit}
            disabled={!canSend}
            className="flex size-9 items-center justify-center rounded-full bg-neutral-100 text-neutral-900 transition-colors hover:bg-white disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:bg-neutral-100"
          >
            <svg
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth={2.25}
              strokeLinecap="round"
              strokeLinejoin="round"
              className="size-5"
              aria-hidden="true"
            >
              <path d="M12 19V5M5 12l7-7 7 7" />
            </svg>
          </button>
        )}
      </div>
    </div>
  );
}
