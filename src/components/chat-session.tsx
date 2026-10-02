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
import { foldVisit, isHardEnded } from "@/lib/visit";

type SaveStatus = "idle" | "saved" | "error";

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
  const abortRef = useRef<AbortController | null>(null);
  // Spec §18.5: closed for good once the persona has left, even when the exit line never arrived
  // (a 409 from another tab, or Stop pressed on the exit turn): the stored acts still fold to `left`.
  const ended =
    refused ||
    isHardEnded(messages) ||
    foldVisit(messages.filter((m) => m.role === "user").map((m) => m.act ?? null)).left;

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
        onBack={onBack}
        onSave={turn || readOnly ? undefined : () => setConfirmingSave(true)}
        saveStatus={saveStatus}
        languageMode={languageMode}
        onLanguageModeChange={changeLanguageMode}
      />
      {ended ? (
        <div
          role="status"
          className="flex w-full max-w-3xl items-center justify-between gap-3 rounded-3xl border border-white/10 bg-neutral-900/80 px-5 py-3 text-sm text-neutral-300 shadow-lg shadow-black/40 backdrop-blur-md"
        >
          <span>{personaName} has ended the conversation.</span>
          <button
            type="button"
            onClick={onBack}
            className="rounded-full bg-neutral-100 px-4 py-1.5 font-medium text-neutral-900 transition-colors hover:bg-white"
          >
            {readOnly ? "Back to history" : "Back to personas"}
          </button>
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
    </>
  );
}
