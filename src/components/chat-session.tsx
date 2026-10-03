"use client";

import { useEffect, useRef, useState } from "react";
import ChatInput from "@/components/chat-input";
import ConfirmDialog from "@/components/confirm-dialog";
import Conversation from "@/components/conversation";
import {
  ChatRequestError,
  applyChatEvent,
  startTurn,
  stoppedMessage,
  streamChat,
  type TurnState,
} from "@/lib/chat-client";
import type { LanguageMode, Message } from "@/lib/chat-types";
import { saveConversation } from "@/lib/conversation-store";
import { loadLanguageMode, saveLanguageMode } from "@/lib/language-mode";
import { shouldWarnBeforeLeaving, showEndBar } from "@/lib/leave-guard";
import { foldVisit, isEnded } from "@/lib/visit";

type SaveStatus = "idle" | "saved" | "error";

// On phones the buttons share one row: same height, same width, no wrapping, smaller text.
const END_BAR_BUTTON = "min-h-11 flex-1 whitespace-nowrap rounded-full px-1.5 py-1.5 text-[length:clamp(10px,2.9vw,12px)] sm:flex-none sm:px-4 sm:text-sm";
const END_BAR_PRIMARY = `${END_BAR_BUTTON} bg-neutral-100 font-medium text-neutral-900 transition-colors hover:bg-white`;
const END_BAR_SECONDARY = `${END_BAR_BUTTON} border border-white/15 text-neutral-200 transition-colors hover:bg-white/10`;

type ChatSessionProps = {
  conversationId: string;
  personaId: string;
  personaName: string;
  initialMessages: Message[];
  /** True when reopened from history, so the Save button starts as "Saved". */
  initiallySaved: boolean;
  /** Spec §22: reopened from history, so it is shown as saved and can't be continued. */
  readOnly?: boolean;
  onBack: () => void;
  /** Spec §23.2: a fresh conversation with the same persona, offered once the visit has ended. */
  onNewVisit: () => void;
};

/**
 * One conversation: sends turns to /api/chat, streams replies in, saves to localStorage. The visitor speaks first.
 * A read-only one (spec §22) has no input and sends nothing.
 */
export default function ChatSession({
  conversationId,
  personaId,
  personaName,
  initialMessages,
  initiallySaved,
  readOnly = false,
  onBack,
  onNewVisit,
}: ChatSessionProps) {
  const [messages, setMessages] = useState<Message[]>(initialMessages);
  const [turn, setTurn] = useState<TurnState | null>(null);
  const [turnError, setTurnError] = useState<{ reason: string; retryable: boolean } | null>(null);
  const [toolsUnavailable, setToolsUnavailable] = useState(false);
  const [saveStatus, setSaveStatus] = useState<SaveStatus>(initiallySaved ? "saved" : "idle");
  // Lazy, like conversation-history: a chat is never server-rendered, since the flow starts at the menu.
  const [languageMode, setLanguageMode] = useState<LanguageMode>(loadLanguageMode);
  const [refused, setRefused] = useState(false);
  const [confirmingSave, setConfirmingSave] = useState(false);
  // Where the visitor was heading when the unsaved-ended dialog opened.
  const [leaving, setLeaving] = useState<null | (() => void)>(null);
  const abortRef = useRef<AbortController | null>(null);
  // Spec §23: every ending is final, even when the exit line never arrived (a 409 from another tab,
  // or Stop pressed on the exit turn): the stored acts still fold to `closed`.
  const ended =
    refused ||
    isEnded(messages) ||
    foldVisit(messages.filter((m) => m.role === "user").map((m) => m.act ?? null)).closed;

  // Leaving the chat (Back) cancels a reply that is still streaming.
  useEffect(() => () => abortRef.current?.abort(), []);

  function changeLanguageMode(mode: LanguageMode) {
    setLanguageMode(mode);
    saveLanguageMode(mode);
  }

  /** Runs one turn: a history that ends with the user's message. */
  async function run(history: Message[]) {
    const controller = new AbortController();
    abortRef.current = controller;
    let state = startTurn(crypto.randomUUID());
    setMessages(history);
    setTurn(state);
    setTurnError(null);
    setSaveStatus("idle"); // a new message makes any earlier save stale

    // Store the act on the user message this turn answers, once the server sent it (spec §18.1).
    const withAct = (list: Message[]): Message[] => {
      if (state.act === undefined) return list;
      const last = list.at(-1);
      return last?.role === "user" ? [...list.slice(0, -1), { ...last, act: state.act }] : list;
    };

    try {
      for await (const event of streamChat({ personaId, messages: history, languageMode, signal: controller.signal })) {
        state = applyChatEvent(state, event);
        setTurn(state);
        // F8: set this as soon as the notice lands, not only after a clean turn, so an
        // errored or stopped turn still shows the banner.
        if (event.type === "notice") setToolsUnavailable(true);
      }
      setToolsUnavailable(state.toolsUnavailable);
      if (state.status === "done") setMessages([...withAct(history), state.message]);
      else {
        setMessages(withAct(history));
        setTurnError(state.error ?? { reason: "The reply was interrupted.", retryable: true });
      }
    } catch (err) {
      if (controller.signal.aborted) {
        const partial = stoppedMessage(state);
        setMessages(partial ? [...withAct(history), partial] : withAct(history));
      } else if (err instanceof ChatRequestError && err.code === "conversation_ended") {
        setRefused(true);
      } else {
        setTurnError(
          err instanceof ChatRequestError
            ? { reason: err.message, retryable: err.retryable }
            : { reason: "Something went wrong.", retryable: true },
        );
      }
    } finally {
      if (abortRef.current === controller) abortRef.current = null;
      setTurn(null);
    }
  }

  function send(text: string) {
    if (turn || ended || readOnly) return; // one turn at a time; none after the persona left or in a record
    void run([...messages, { id: crypto.randomUUID(), role: "user", text }]);
  }

  // Saved to localStorage as JSON, never to the database — see conversation-store.
  // Saving ends the conversation, so it is confirmed first; a failed save stays in the chat.
  function saveAndEnd() {
    setConfirmingSave(false);
    const ok = saveConversation({
      id: conversationId,
      personaId,
      personaName,
      savedAt: new Date().toISOString(),
      messages,
    });
    setSaveStatus(ok ? "saved" : "error");
    if (ok) onBack();
  }

  /** Spec §23.2: an ended visit saves in place. There's nothing left to end, so no confirm. */
  function saveInPlace(): boolean {
    const ok = saveConversation({
      id: conversationId,
      personaId,
      personaName,
      savedAt: new Date().toISOString(),
      messages,
    });
    setSaveStatus(ok ? "saved" : "error");
    return ok;
  }

  /** Leaves now, or first asks about an ended visit that isn't saved. */
  function leave(go: () => void) {
    if (shouldWarnBeforeLeaving({ ended, saveStatus, readOnly })) setLeaving(() => go);
    else go();
  }

  // Re-send the same history, which ends with the user's message.
  const retry = () => {
    if (!readOnly) void run(messages);
  };

  return (
    <>
      <Conversation
        personaName={personaName}
        messages={messages}
        pending={turn?.message}
        turnError={turnError}
        onRetry={turnError?.retryable && !turn && !readOnly ? retry : undefined}
        toolsUnavailable={toolsUnavailable}
        onBack={() => leave(onBack)}
        onSave={turn || readOnly ? undefined : ended ? () => void saveInPlace() : () => setConfirmingSave(true)}
        saveStatus={saveStatus}
        languageMode={languageMode}
        onLanguageModeChange={changeLanguageMode}
      />
      {showEndBar({ ended, streaming: turn !== null }) ? (
        <div
          role="status"
          className="flex w-full max-w-3xl flex-wrap items-center justify-between gap-3 rounded-3xl border border-white/10 bg-neutral-900/80 px-5 py-3 text-sm text-neutral-300 shadow-lg shadow-black/40 backdrop-blur-md"
        >
          <span>{personaName} has ended the visit.</span>
          <div className="flex w-full gap-1.5 sm:w-auto sm:gap-2">
            {readOnly ? (
              <button type="button" onClick={onBack} className={END_BAR_PRIMARY}>
                Back to history
              </button>
            ) : (
              <>
                <button type="button" onClick={() => leave(onNewVisit)} className={END_BAR_PRIMARY}>
                  Start a new visit
                </button>
                {saveStatus !== "saved" && (
                  <button type="button" onClick={() => void saveInPlace()} className={END_BAR_SECONDARY}>
                    Save
                  </button>
                )}
                <button type="button" onClick={() => leave(onBack)} className={END_BAR_SECONDARY}>
                  Back to personas
                </button>
              </>
            )}
          </div>
        </div>
      ) : readOnly ? null : (
        <ChatInput onSend={send} onStop={() => abortRef.current?.abort()} streaming={turn !== null} />
      )}
      <ConfirmDialog
        open={confirmingSave}
        title="Save conversation"
        message={`Saving will end your conversation with ${personaName}.`}
        onConfirm={saveAndEnd}
        onCancel={() => setConfirmingSave(false)}
      />
      <ConfirmDialog
        open={leaving !== null}
        title={`Your conversation with ${personaName} isn't saved.`}
        message="Save it to keep it in your history."
        confirmLabel="Save and leave"
        secondaryLabel="Leave without saving"
        onConfirm={() => {
          const go = leaving;
          setLeaving(null);
          // A failed save stays here: the header shows the error, and nothing is lost.
          if (saveInPlace()) go?.();
        }}
        onSecondary={() => {
          const go = leaving;
          setLeaving(null);
          go?.();
        }}
        onCancel={() => setLeaving(null)}
      />
    </>
  );
}
