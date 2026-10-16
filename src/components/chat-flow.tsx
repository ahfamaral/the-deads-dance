"use client";

import Link from "next/link";
import { useEffect, useRef, useState, type ReactNode } from "react";
import ChatSession from "@/components/chat-session";
import ConversationHistory from "@/components/conversation-history";
import PersonaPicker from "@/components/persona-picker";
import RatingSheet from "@/components/rating-sheet";
import SignOutButton from "@/components/sign-out-button";
import VoicePanel from "@/components/voice-panel";
import type { ChatStreamEvent, Message, Spend } from "@/lib/chat-types";
import type { StoredConversation } from "@/lib/conversation-types";
import { fetchConversation, sendFeedback } from "@/lib/conversations-api";
import type { Feedback } from "@/lib/feedback";
import { canRestoreLive, linkedConversation, readOpenChat, writeOpenChat } from "@/lib/open-chat";
import type { BannerThreshold } from "@/lib/energy";
import { applyMeterEvent, markBannerRead, parseMeter, type Meter } from "@/lib/meter";
import { ensureAccess } from "@/lib/ensure-access";
import { newId } from "@/lib/new-id";
import { requestHidden } from "@/lib/persona-hide-api";
import type { Persona } from "@/lib/personas";
import type { AccessBody } from "@/lib/server/access-info";

type ChatStep = {
  name: "chat";
  conversationId: string;
  personaId: string;
  personaName: string;
  messages: Message[];
  /** Where "Back" returns to: the picker for a live chat, History for a record (read-only, spec §22). */
  backTo: "select" | "history";
  /** Spec §27: the owner's email when the admin opens someone else's conversation. */
  ownerEmail?: string;
  /** Admin only: the conversation's totals so far. */
  spend?: Spend;
  /** Spec §26.4: the server is still writing the last reply. */
  turnRunning?: boolean;
  /** Spec §32.6: a record's rating. */
  feedback?: Feedback | null;
};
type Step = { name: "start" } | { name: "history" } | { name: "select" } | { name: "restoring" } | ChatStep;

/**
 * Walks the user from the start menu, through choosing a persona, to the chat.
 * The start menu also leads to the history of conversations.
 */
type ChatFlowProps = {
  initialPersonas: Persona[];
  personasUnavailable: boolean;
  email: string;
  isAdmin: boolean;
  initialAccess: AccessBody | null;
};

export default function ChatFlow({ initialPersonas, personasUnavailable, email, isAdmin, initialAccess }: ChatFlowProps) {
  const [step, setStep] = useState<Step>({ name: "start" });
  // Held here rather than in the picker so changes survive a trip to the chat and back.
  const [personas, setPersonas] = useState<Persona[]>(initialPersonas);
  // Spec §33.3: the persona whose Voice panel is open (admin).
  const [voicePanelFor, setVoicePanelFor] = useState<Persona | null>(null);
  const [pickerNotice, setPickerNotice] = useState<string | null>(
    personasUnavailable ? "Personas unavailable: database not reachable." : null,
  );

  // Spec §26.5: the tester's energy, or the admin's spend; refreshed by every access check.
  const [meter, setMeter] = useState<Meter | null>(() => parseMeter(initialAccess));
  const onMeterEvent = (event: ChatStreamEvent) => setMeter((m) => (m ? applyMeterEvent(m, event) : m));
  // Spec §26.5: remembered on the server; the screen moves on at once.
  const dismissBanner = (threshold: BannerThreshold) => {
    setMeter((m) => (m?.kind === "energy" ? { ...m, warningRead: threshold } : m));
    void markBannerRead(threshold);
  };
  const outOfEnergyNow = () => setMeter((m) => (m?.kind === "energy" ? { ...m, left: 0 } : m));

  const [startNotice, setStartNotice] = useState<string | null>(null);
  // Spec §32.4: the conversation just left, rated over the next screen.
  const [rating, setRating] = useState<{ conversationId: string; personaName: string } | null>(null);

  /** A record from History (spec §22), or from the admin's Feedback list (spec §32.7). */
  const recordStep = (c: StoredConversation): ChatStep => ({
    name: "chat",
    conversationId: c.id,
    personaId: c.personaId,
    personaName: c.personaName,
    messages: c.messages,
    backTo: "history",
    spend: c.spend,
    turnRunning: c.turnRunning,
    ownerEmail: c.userEmail && c.userEmail !== email ? c.userEmail : undefined,
    feedback: c.feedback ?? null,
  });

  /** A live chat. This tab remembers it, so a reload brings it back (spec §25.5). */
  function openLive(chat: Omit<ChatStep, "name" | "backTo">) {
    writeOpenChat({ conversationId: chat.conversationId, personaId: chat.personaId });
    setStep({ name: "chat", backTo: "select", ...chat });
  }
  const startChat = (persona: { id: string; name: string }) =>
    openLive({ conversationId: newId(), personaId: persona.id, personaName: persona.name, messages: [] });

  // Spec §25.5: the open chat survives a reload of its own tab. sessionStorage is only readable
  // after hydration, so this is an effect; it runs once.
  useEffect(() => {
    // Spec §32.7: /?open=<id> from the admin's Feedback list opens that conversation read-only.
    const linked = linkedConversation(window.location.search);
    if (linked) {
      window.history.replaceState(null, "", "/");
      // eslint-disable-next-line react-hooks/set-state-in-effect -- flips to the loading screen before the async fetch
      setStep({ name: "restoring" });
      void fetchConversation(linked).then((result) => {
        if (result.kind === "found") setStep(recordStep(result.conversation));
        else {
          setStartNotice("Couldn't open that conversation.");
          setStep({ name: "start" });
        }
      });
      return;
    }
    const saved = readOpenChat();
    if (!saved) return;
    setStep({ name: "restoring" });
    void fetchConversation(saved.conversationId).then((result) => {
      if (result.kind === "found" && !canRestoreLive(result.conversation, email)) {
        // Another account's chat, left in this tab before a sign-in switch: never reopen it live.
        writeOpenChat(null);
        setStep({ name: "start" });
      } else if (result.kind === "found") {
        const c = result.conversation;
        openLive({ conversationId: c.id, personaId: c.personaId, personaName: c.personaName, messages: c.messages, spend: c.spend, turnRunning: c.turnRunning });
      } else if (result.kind === "missing") {
        // Nothing was sent yet, or it was deleted elsewhere: a fresh chat with the same persona.
        const persona = initialPersonas.find((p) => p.id === saved.personaId);
        if (persona) startChat(persona);
        else {
          writeOpenChat(null);
          setStep({ name: "start" });
        }
      } else {
        // Kept for the next try.
        setStartNotice("Couldn't reopen your conversation. Try again in a minute.");
        setStep({ name: "start" });
      }
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps -- once, on mount
  }, []);

  // A blocked or rejected tester is sent back to sign-in on their next screen change, or when they
  // return to the tab, even without chatting. The page itself just checked, so the first screen doesn't.
  const firstStep = useRef(true);
  useEffect(() => {
    if (firstStep.current) {
      firstStep.current = false;
      return;
    }
    void ensureAccess().then((m) => {
      if (m) setMeter(m);
    });
  }, [step]);
  useEffect(() => {
    const onVisible = () => {
      if (document.visibilityState === "visible") {
        void ensureAccess().then((m) => {
          if (m) setMeter(m);
        });
      }
    };
    document.addEventListener("visibilitychange", onVisible);
    return () => document.removeEventListener("visibilitychange", onVisible);
  }, []);

  async function removePersona(persona: Persona) {
    setPickerNotice(null);
    try {
      const res = await fetch(`/api/personas/${encodeURIComponent(persona.id)}`, { method: "DELETE" });
      // 404 means it is already gone (a second click, another tab), which is what the user wanted.
      if (res.ok || res.status === 404) {
        setPersonas((current) => current.filter((p) => p.id !== persona.id));
        return;
      }
      const data = await res.json().catch(() => ({}));
      setPickerNotice(data.error ?? "Couldn't remove the persona.");
    } catch {
      setPickerNotice("Couldn't reach the server.");
    }
  }

  const sheet = rating && (
    <RatingSheet
      key={rating.conversationId}
      open
      personaName={rating.personaName}
      initial={null}
      onSave={(f) => sendFeedback(rating.conversationId, f)}
      onSaved={() => setRating(null)}
      onClose={() => setRating(null)}
    />
  );
  // Every screen carries the sheet, so it stays open across the screen change that follows an exit.
  const withSheet = (screen: ReactNode) => (
    <>
      {screen}
      {sheet}
    </>
  );

  /** 2026-10-16: the admin hides a persona from testers' picker, or shows it again. */
  async function toggleHidden(persona: Persona) {
    setPickerNotice(null);
    const hidden = await requestHidden(persona.id, !persona.hidden);
    if (hidden === null) {
      setPickerNotice(persona.hidden ? "Couldn't show the persona." : "Couldn't hide the persona.");
      return;
    }
    setPersonas((current) => current.map((p) => (p.id === persona.id ? { ...p, hidden } : p)));
  }

  if (step.name === "start") {
    // A lighter backdrop than the other panels, so the menu reads as secondary.
    const menuSurface =
      "w-full rounded-3xl border border-white/10 bg-neutral-900/50 px-5 shadow-lg shadow-black/30 pointer-coarse:bg-neutral-900/85 pointer-fine:backdrop-blur-md";
    const menuButton = `${menuSurface} py-3 text-sm font-medium transition-colors hover:border-white/40 hover:bg-neutral-700/70 hover:text-foreground focus-visible:border-white/40 focus-visible:outline-none`;
    return withSheet(
      <div className="flex flex-1 items-center justify-center">
        <nav aria-label="Start" className="flex w-full max-w-xs flex-col gap-3">
          {startNotice && (
            <p role="alert" className="text-center text-sm text-neutral-400">
              {startNotice}
            </p>
          )}
          <button
            type="button"
            onClick={() => setStep({ name: "select" })}
            className={`${menuButton} text-foreground`}
          >
            New conversation
          </button>
          <button
            type="button"
            onClick={() => setStep({ name: "history" })}
            className={`${menuButton} text-neutral-300`}
          >
            History of conversations
          </button>
          {isAdmin && (
            <Link href="/admin" className={`${menuButton} text-center text-neutral-300`}>
              Admin
            </Link>
          )}
          {/* The menu's surface, not a button. One line, same height: the email shrinks (truncates) and Sign out keeps its size. */}
          <div className={`${menuSurface} flex items-center justify-center gap-2 text-[length:clamp(10px,2.9vw,12px)] text-neutral-400`}>
            <span className="min-w-0 truncate" title={email}>{email}</span>
            <span aria-hidden="true">·</span>
            <SignOutButton className="inline-flex min-h-11 shrink-0 items-center whitespace-nowrap px-1 text-neutral-300 underline underline-offset-2 hover:text-foreground" />
          </div>
        </nav>
      </div>
    );
  }

  if (step.name === "restoring") {
    return withSheet(<p className="m-auto text-sm text-neutral-500">Loading…</p>);
  }

  if (step.name === "history") {
    return withSheet(
      <ConversationHistory
        onBack={() => setStep({ name: "start" })}
        onOpen={(c: StoredConversation) => setStep(recordStep(c))}
      />
    );
  }

  if (step.name === "select") {
    return withSheet(
      <>
      {voicePanelFor && (
        <VoicePanel
          key={voicePanelFor.id}
          persona={voicePanelFor}
          open
          onClose={() => setVoicePanelFor(null)}
          onChanged={({ status, voiceLanguages }) =>
            setPersonas((current) => current.map((p) => (p.id === voicePanelFor.id ? { ...p, voiceStatus: status, voiceLanguages } : p)))
          }
        />
      )}
      <PersonaPicker
        personas={personas}
        canManage={isAdmin}
        notice={pickerNotice}
        onConfirm={(persona) => startChat(persona)}
        onBack={() => setStep({ name: "start" })}
        onDelete={removePersona}
        onToggleHidden={(persona) => void toggleHidden(persona)}
        onEditVoice={setVoicePanelFor}
        onAdd={(persona) => setPersonas((current) => [...current, persona])}
        meter={meter}
        onDismissBanner={dismissBanner}
      />
      </>
    );
  }

  return withSheet(
    <ChatSession
      key={step.conversationId}
      conversationId={step.conversationId}
      personaId={step.personaId}
      personaName={step.personaName}
      ownerEmail={step.ownerEmail}
      initialMessages={step.messages}
      readOnly={step.backTo === "history"}
      onBack={(askRating) => {
        if (askRating) setRating({ conversationId: step.conversationId, personaName: step.personaName });
        // Leaving a live chat: from now on it opens from History, read-only (spec §25.5).
        if (step.backTo === "select") writeOpenChat(null);
        setStep(step.backTo === "history" ? { name: "history" } : { name: "select" });
      }}
      onNewVisit={(askRating) => {
        if (askRating) setRating({ conversationId: step.conversationId, personaName: step.personaName });
        startChat({ id: step.personaId, name: step.personaName });
      }}
      meter={meter}
      onMeterEvent={onMeterEvent}
      onDismissBanner={dismissBanner}
      onOutOfEnergy={outOfEnergyNow}
      initialSpend={step.spend}
      initialTurnRunning={step.turnRunning}
      initialFeedback={step.feedback}
    />
  );
}
