"use client";

import { useState } from "react";
import ChatSession from "@/components/chat-session";
import ConversationHistory from "@/components/conversation-history";
import PersonaPicker from "@/components/persona-picker";
import type { Message } from "@/lib/chat-types";
import type { SavedConversation } from "@/lib/conversation-store";
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
};

export default function ChatFlow({ initialPersonas, personasUnavailable }: ChatFlowProps) {
  const [step, setStep] = useState<Step>({ name: "start" });
  // Held here rather than in the picker so changes survive a trip to the chat and back.
  const [personas, setPersonas] = useState<Persona[]>(initialPersonas);
  const [pickerNotice, setPickerNotice] = useState<string | null>(
    personasUnavailable ? "Personas unavailable: database not reachable." : null,
  );

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
    const menuButton =
      "w-full rounded-3xl border border-white/10 bg-neutral-900/50 px-5 py-3 text-sm font-medium shadow-lg shadow-black/30 backdrop-blur-md transition-colors hover:border-white/40 hover:bg-neutral-700/70 hover:text-foreground focus-visible:border-white/40 focus-visible:outline-none";
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
