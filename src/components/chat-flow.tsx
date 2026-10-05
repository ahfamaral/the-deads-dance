"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import ChatSession from "@/components/chat-session";
import ConversationHistory from "@/components/conversation-history";
import PersonaPicker from "@/components/persona-picker";
import SignOutButton from "@/components/sign-out-button";
import type { Message } from "@/lib/chat-types";
import type { SavedConversation } from "@/lib/conversation-store";
import { ensureAccess } from "@/lib/ensure-access";
import type { Persona } from "@/lib/personas";

type Step =
  | { name: "start" }
  | { name: "history" }
  | { name: "select" }
  | {
      name: "chat";
      conversationId: string;
      personaId: string;
      personaName: string;
      messages: Message[];
      /** Where "Back" returns to: the picker for a new chat, the history for a saved one. */
      backTo: "select" | "history";
      /** Reopened from history, so it starts as saved. */
      saved: boolean;
    };

/**
 * Walks the user from the start menu, through choosing a persona, to the chat.
 * The start menu also leads to the history of saved conversations.
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

  if (step.name === "history") {
    return (
      <ConversationHistory
        onBack={() => setStep({ name: "start" })}
        onOpen={(saved: SavedConversation) =>
          setStep({
            name: "chat",
            conversationId: saved.id,
            personaId: saved.personaId,
            personaName: saved.personaName,
            messages: saved.messages,
            backTo: "history",
            saved: true,
          })
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
        onConfirm={(persona) =>
          setStep({
            name: "chat",
            conversationId: crypto.randomUUID(),
            personaId: persona.id,
            personaName: persona.name,
            messages: [],
            backTo: "select",
            saved: false,
          })
        }
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
      initiallySaved={step.saved}
      readOnly={step.backTo === "history"}
      onBack={() => setStep(step.backTo === "history" ? { name: "history" } : { name: "select" })}
      onNewVisit={() =>
        setStep({
          name: "chat",
          conversationId: crypto.randomUUID(),
          personaId: step.personaId,
          personaName: step.personaName,
          messages: [],
          backTo: "select",
          saved: false,
        })
      }
    />
  );
}
