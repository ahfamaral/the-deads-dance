"use client";

import { useEffect, useRef, useState } from "react";
import ChatInput from "@/components/chat-input";
import ConfirmDialog from "@/components/confirm-dialog";
import Conversation from "@/components/conversation";
import EnergyBar from "@/components/energy-bar";
import EnergyNotice from "@/components/energy-notice";
import SpendBadge from "@/components/spend-badge";
import { fetchConversation } from "@/lib/conversations-api";
import { ChatRequestError, streamChat } from "@/lib/chat-client";
import { applyChatEvent, startTurn, type TurnState } from "@/lib/turn-state";
import type { ChatStreamEvent, LanguageMode, Message, Spend, TurnSpend } from "@/lib/chat-types";
import { dueBanner, type BannerThreshold } from "@/lib/energy";
import { loadLanguageMode, saveLanguageMode } from "@/lib/language-mode";
import { confirmBeforeLeaving, showEndBar } from "@/lib/leave-guard";
import { isOutOfEnergy, type Meter } from "@/lib/meter";
import { newId } from "@/lib/new-id";
import { foldVisit, isEnded } from "@/lib/visit";
import { waitForReply } from "@/lib/wait-for-reply";

// On phones the buttons share one row: same height, same width, no wrapping, smaller text.
const END_BAR_BUTTON = "min-h-11 flex-1 whitespace-nowrap rounded-full px-1.5 py-1.5 text-[length:clamp(10px,2.9vw,12px)] sm:flex-none sm:px-4 sm:text-sm";
const END_BAR_PRIMARY = `${END_BAR_BUTTON} bg-neutral-100 font-medium text-neutral-900 transition-colors hover:bg-white`;
const END_BAR_SECONDARY = `${END_BAR_BUTTON} border border-white/15 text-neutral-200 transition-colors hover:bg-white/10`;

type ChatSessionProps = {
  conversationId: string;
  personaId: string;
  personaName: string;
  /** Spec §27: the owner's email when the admin opens someone else's conversation. */
  ownerEmail?: string;
  initialMessages: Message[];
  /** Spec §22: reopened from history, so it can't be continued. */
  readOnly?: boolean;
  onBack: () => void;
  /** Spec §23.2: a fresh conversation with the same persona, offered once the visit has ended. */
  onNewVisit: () => void;
  /** Spec §26.5–6: the tester's energy, or the admin's spend; null if it couldn't be read. */
  meter: Meter | null;
  onMeterEvent: (event: ChatStreamEvent) => void;
  onDismissBanner: (threshold: BannerThreshold) => void;
  /** A send was refused with out_of_energy (another tab spent the last of it). */
  onOutOfEnergy: () => void;
  /** Admin only: the conversation's totals so far. */
  initialSpend?: Spend;
  /** Spec §26.4: the server is still writing this conversation's reply. */
  initialTurnRunning?: boolean;
};

/**
 * One conversation: sends turns to /api/chat and streams replies in; the server stores every turn (spec §25). The visitor speaks first.
 * A read-only one (spec §22) has no input and sends nothing.
 */
export default function ChatSession({
  conversationId,
  personaId,
  personaName,
  ownerEmail,
  initialMessages,
  readOnly = false,
  onBack,
  onNewVisit,
  meter,
  onMeterEvent,
  onDismissBanner,
  onOutOfEnergy,
  initialSpend,
  initialTurnRunning,
}: ChatSessionProps) {
  const [messages, setMessages] = useState<Message[]>(initialMessages);
  const [turn, setTurn] = useState<TurnState | null>(null);
  // A live chat reloaded with the visitor's message unanswered (the reply never arrived): offer Retry.
  // Retry sends `retry: true`, since that message is already on the server (the re-sync below covers
  // the case where the server has answered it meanwhile).
  const unansweredAtStart =
    !readOnly &&
    initialMessages.at(-1)?.role === "user" &&
    !isEnded(initialMessages) &&
    !foldVisit(initialMessages.filter((m) => m.role === "user").map((m) => m.act ?? null)).closed;
  // Spec §26.4: if the server is still writing the reply, wait for it; otherwise offer Retry.
  const [waiting, setWaiting] = useState(() => unansweredAtStart && initialTurnRunning === true);
  const [startsUnanswered] = useState(() => unansweredAtStart && initialTurnRunning !== true);
  const [turnError, setTurnError] = useState<{ reason: string; retryable: boolean } | null>(
    startsUnanswered ? { reason: "The reply was interrupted.", retryable: true } : null,
  );
  const [spend, setSpend] = useState<Spend>(initialSpend ?? { tokens: 0, cost: 0 });
  const [lastTurn, setLastTurn] = useState<TurnSpend | null>(null);
  const isAdmin = meter?.kind === "spend";
  const outOfEnergy = isOutOfEnergy(meter);
  const [toolsUnavailable, setToolsUnavailable] = useState(false);
  // Lazy, like conversation-history: a chat is never server-rendered, since the flow starts at the menu.
  const [languageMode, setLanguageMode] = useState<LanguageMode>(loadLanguageMode);
  const [refused, setRefused] = useState(false);
  const abortRef = useRef<AbortController | null>(null);
  const [gone, setGone] = useState(false);
  const [confirmingLeave, setConfirmingLeave] = useState(false);
  // Spec §25.3: true once the server has the conversation. Only a first message may create it.
  const confirmed = useRef(initialMessages.length > 0);
  // Whether the last failed turn's visitor message reached the server: Retry answers it there;
  // otherwise the text is simply sent again. A failed retry attempt keeps this true, since the
  // message was already stored before the retry was sent.
  const lastTurnStored = useRef(startsUnanswered);
  // Spec §23: every ending is final, even when the exit line never arrived (a 409 from another tab,
  // or a reply the server finished on its own): the stored acts still fold to `closed`.
  const ended =
    refused ||
    isEnded(messages) ||
    foldVisit(messages.filter((m) => m.role === "user").map((m) => m.act ?? null)).closed;

  // Leaving the chat stops listening; the server finishes the turn (spec §26.4).
  useEffect(() => () => abortRef.current?.abort(), []);

  // Spec §26.5: poll until the server has finished the turn, then show what it stored.
  useEffect(() => {
    if (!waiting) return;
    const controller = new AbortController();
    void waitForReply(conversationId, { signal: controller.signal }).then((conversation) => {
      if (controller.signal.aborted) return;
      setWaiting(false);
      if (!conversation) {
        setTurnError({ reason: "The reply was interrupted.", retryable: true });
        lastTurnStored.current = true;
        return;
      }
      setMessages(conversation.messages);
      if (conversation.spend) setSpend(conversation.spend);
      if (conversation.messages.at(-1)?.role === "user") {
        setTurnError({ reason: "The reply was interrupted.", retryable: true });
        lastTurnStored.current = true;
      }
    });
    return () => controller.abort();
  }, [waiting, conversationId]);

  function changeLanguageMode(mode: LanguageMode) {
    setLanguageMode(mode);
    saveLanguageMode(mode);
  }

  /** Runs one turn: a history that ends with the user's message. */
  async function run(history: Message[], { retry = false }: { retry?: boolean } = {}) {
    const controller = new AbortController();
    abortRef.current = controller;
    let state = startTurn(newId());
    let stored = false;
    let resynced = false;
    setMessages(history);
    setTurn(state);
    setTurnError(null);

    // Store the act on the user message this turn answers, once the server sent it (spec §18.1).
    const withAct = (list: Message[]): Message[] => {
      if (state.act === undefined) return list;
      const last = list.at(-1);
      return last?.role === "user" ? [...list.slice(0, -1), { ...last, act: state.act }] : list;
    };

    try {
      for await (const event of streamChat({
        conversationId,
        personaId,
        text: retry ? undefined : history.at(-1)?.text,
        retry,
        first: !confirmed.current,
        languageMode,
        signal: controller.signal,
      })) {
        // The server stores the visitor message before it streams anything.
        stored = true;
        confirmed.current = true;
        state = applyChatEvent(state, event);
        if (event.type === "energy" || event.type === "cost") onMeterEvent(event);
        if (event.type === "cost") {
          setSpend(event.conversation);
          setLastTurn(event.turn);
        }
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
      if (controller.signal.aborted) return;
      if (err instanceof ChatRequestError && err.code === "out_of_energy") {
        // Spec §26.5: nothing was stored; the banner and the disabled box explain.
        setMessages(retry ? history : history.slice(0, -1));
        onOutOfEnergy();
      } else if (err instanceof ChatRequestError && (err.code === "turn_in_progress" || err.code === "stream_interrupted")) {
        // Spec §26.4: the server is still writing a reply; wait for it instead of retrying.
        setMessages(withAct(history));
        setWaiting(true);
      } else if (err instanceof ChatRequestError && (err.code === "unauthenticated" || err.code === "not_approved")) {
        // Spec §24.5: signed out or blocked mid-chat; the page picks the right screen.
        window.location.reload();
      } else if (err instanceof ChatRequestError && err.code === "conversation_ended") {
        setRefused(true);
      } else if (err instanceof ChatRequestError && err.code === "unknown_conversation") {
        setGone(true); // spec §25.5: deleted elsewhere, or not this user's
      } else if (err instanceof ChatRequestError && err.code === "nothing_to_retry") {
        // The server has no unanswered message: it stored the reply (or a partial one) after a dropped
        // stream. Show what it has instead of what this tab thinks it has.
        const result = await fetchConversation(conversationId);
        if (result.kind === "found") {
          resynced = true;
          setMessages(result.conversation.messages);
          setTurnError(null);
        } else if (result.kind === "missing") {
          setGone(true);
        } else {
          setTurnError({ reason: err.message, retryable: err.retryable });
        }
      } else {
        setTurnError(
          err instanceof ChatRequestError
            ? { reason: err.message, retryable: err.retryable }
            : { reason: "Something went wrong.", retryable: true },
        );
      }
    } finally {
      // After a re-sync the screen matches the server, so the next message is a plain send.
      lastTurnStored.current = !resynced && (stored || retry); // a retry attempt means it was already on the server
      if (abortRef.current === controller) abortRef.current = null;
      setTurn(null);
    }
  }

  function send(text: string) {
    if (turn || waiting || outOfEnergy || ended || readOnly || gone) return; // one turn at a time; none after the persona left or in a record
    void run([...messages, { id: newId(), role: "user", text }]);
  }

  // The last message is the user's: answer it again on the server, or resend it if it never got there.
  const retry = () => {
    if (!readOnly && !gone && !waiting) void run(messages, { retry: lastTurnStored.current });
  };

  const banner = meter?.kind === "energy" && !readOnly ? dueBanner(meter.left, meter.warningRead) : null;
  const meterSlot =
    meter?.kind === "spend" ? (
      <SpendBadge spend={spend} lastTurn={lastTurn} />
    ) : meter?.kind === "energy" && !readOnly ? (
      <EnergyBar left={meter.left} />
    ) : null;

  return (
    <>
      <Conversation
        personaName={personaName}
        ownerEmail={ownerEmail}
        messages={messages}
        pending={turn?.message}
        turnError={turnError}
        onRetry={turnError?.retryable && !turn && !readOnly && !waiting ? retry : undefined}
        toolsUnavailable={toolsUnavailable}
        onBack={() =>
          confirmBeforeLeaving({ readOnly, ended, gone, hasMessages: messages.length > 0 }) ? setConfirmingLeave(true) : onBack()
        }
        languageMode={languageMode}
        onLanguageModeChange={changeLanguageMode}
        meterSlot={meterSlot}
        notice={banner !== null ? <EnergyNotice threshold={banner} onDismiss={() => onDismissBanner(banner)} /> : null}
        waiting={waiting}
        showCost={isAdmin}
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
                <button type="button" onClick={onNewVisit} className={END_BAR_PRIMARY}>
                  Start a new visit
                </button>
                <button type="button" onClick={onBack} className={END_BAR_SECONDARY}>
                  Back to personas
                </button>
              </>
            )}
          </div>
        </div>
      ) : readOnly ? null : gone ? (
        <p
          role="status"
          className="w-full max-w-3xl rounded-3xl border border-white/10 bg-neutral-900/80 px-5 py-3 text-sm text-neutral-300 shadow-lg shadow-black/40 backdrop-blur-md"
        >
          This conversation is no longer available.
        </p>
      ) : (
        <ChatInput onSend={send} busy={turn !== null || waiting} disabledReason={outOfEnergy ? "Out of energy" : undefined} />
      )}
      <ConfirmDialog
        open={confirmingLeave}
        title="Leave this conversation?"
        message="You can read it later in History, but you won't be able to continue it."
        confirmLabel="Leave"
        onConfirm={() => {
          setConfirmingLeave(false);
          onBack();
        }}
        onCancel={() => setConfirmingLeave(false)}
      />
    </>
  );
}
