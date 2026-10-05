"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import ChatSession from "@/components/chat-session";
import ConversationHistory from "@/components/conversation-history";
import PersonaPicker from "@/components/persona-picker";
import SignOutButton from "@/components/sign-out-button";
import type { Message } from "@/lib/chat-types";
import type { StoredConversation } from "@/lib/conversation-types";
import { fetchConversation } from "@/lib/conversations-api";
import { readOpenChat, writeOpenChat } from "@/lib/open-chat";
import { ensureAccess } from "@/lib/ensure-access";
import { newId } from "@/lib/new-id";
import type { Persona } from "@/lib/personas";

type ChatStep = {
  name: "chat";
  conversationId: string;
  personaId: string;
  personaName: string;
  messages: Message[];
  /** Where "Back" returns to: the picker for a live chat, History for a record (read-only, spec §22). */
  backTo: "select" | "history";
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
};

export default function ChatFlow({ initialPersonas, personasUnavailable, email, isAdmin }: ChatFlowProps) {
  const [step, setStep] = useState<Step>({ name: "start" });
  // Held here rather than in the picker so changes survive a trip to the chat and back.
  const [personas, setPersonas] = useState<Persona[]>(initialPersonas);
  const [pickerNotice, setPickerNotice] = useState<string | null>(
    personasUnavailable ? "Personas unavailable: database not reachable." : null,
  );

  const [startNotice, setStartNotice] = useState<string | null>(null);

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
    const saved = readOpenChat();
    if (!saved) return;
    // eslint-disable-next-line react-hooks/set-state-in-effect -- flips to the loading screen before the async fetch
    setStep({ name: "restoring" });
    void fetchConversation(saved.conversationId).then((result) => {
      if (result.kind === "found") {
        const c = result.conversation;
        openLive({ conversationId: c.id, personaId: c.personaId, personaName: c.personaName, messages: c.messages });
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
    void ensureAccess();
  }, [step]);
  useEffect(() => {
    const onVisible = () => {
      if (document.visibilityState === "visible") void ensureAccess();
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

  if (step.name === "start") {
    // A lighter backdrop than the other panels, so the menu reads as secondary.
    const menuSurface =
      "w-full rounded-3xl border border-white/10 bg-neutral-900/50 px-5 shadow-lg shadow-black/30 backdrop-blur-md";
    const menuButton = `${menuSurface} py-3 text-sm font-medium transition-colors hover:border-white/40 hover:bg-neutral-700/70 hover:text-foreground focus-visible:border-white/40 focus-visible:outline-none`;
    return (
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
    return <p className="m-auto text-sm text-neutral-500">Loading…</p>;
  }

  if (step.name === "history") {
    return (
      <ConversationHistory
        onBack={() => setStep({ name: "start" })}
        onOpen={(c: StoredConversation) =>
          setStep({ name: "chat", conversationId: c.id, personaId: c.personaId, personaName: c.personaName, messages: c.messages, backTo: "history" })
        }
      />
    );
  }

  if (step.name === "select") {
    return (
      <PersonaPicker
        personas={personas}
        canManage={isAdmin}
        notice={pickerNotice}
        onConfirm={(persona) => startChat(persona)}
        onBack={() => setStep({ name: "start" })}
        onDelete={removePersona}
        onAdd={(persona) => setPersonas((current) => [...current, persona])}
      />
    );
  }

  return (
    <ChatSession
      key={step.conversationId}
      conversationId={step.conversationId}
      personaId={step.personaId}
      personaName={step.personaName}
      initialMessages={step.messages}
      readOnly={step.backTo === "history"}
      onBack={() => {
        // Leaving a live chat: from now on it opens from History, read-only (spec §25.5).
        if (step.backTo === "select") writeOpenChat(null);
        setStep(step.backTo === "history" ? { name: "history" } : { name: "select" });
      }}
      onNewVisit={() => startChat({ id: step.personaId, name: step.personaName })}
    />
  );
}
