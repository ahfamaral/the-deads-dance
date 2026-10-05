"use client";

import { useState } from "react";
import AddPersonaForm from "@/components/add-persona-form";
import type { Persona } from "@/lib/personas";
import { useScrollFade } from "@/lib/use-scroll-fade";

type PersonaPickerProps = {
  personas: Persona[];
  canManage: boolean;
  notice: string | null;
  onConfirm: (persona: Persona) => void;
  onDelete: (persona: Persona) => void;
  onAdd: (persona: Persona) => void;
  onBack: () => void;
};

/**
 * Lets the user choose who to talk to. Selecting a persona reveals a
 * "Talk to" button on its row, which confirms the choice. The gear toggles a
 * configure mode that swaps "Talk to" for a delete button and shows an
 * "add persona" button under the gear, which opens a form that adds a
 * persona from a Wikipedia title. Built-in personas show a disabled trash icon.
 * While a persona is being added, every other button in the panel is disabled.
 */
export default function PersonaPicker({ personas, canManage, notice, onConfirm, onDelete, onAdd, onBack }: PersonaPickerProps) {
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [configuring, setConfiguring] = useState(false);
  const [adding, setAdding] = useState(false);
  const [busy, setBusy] = useState(false);
  const listFade = useScrollFade();

  function toggleConfiguring() {
    setConfiguring((value) => !value);
    setSelectedId(null);
    setAdding(false);
  }

  return (
    // min-h-0 and max-h-full keep the panel within the screen; only the list
    // scrolls, so Back, the heading, the gear and the add form stay in view.
    <div className="flex min-h-0 flex-1 items-center justify-center">
      <section
        aria-labelledby="persona-picker-heading"
        className="flex max-h-full w-full max-w-md flex-col overflow-hidden rounded-3xl border border-white/10 bg-neutral-900/80 p-5 shadow-lg shadow-black/40 backdrop-blur-md"
      >
        <button
          type="button"
          onClick={onBack}
          disabled={busy}
          className="-ml-2 mb-3 flex items-center gap-1.5 rounded-full px-3 py-1.5 text-sm text-neutral-400 transition-colors hover:bg-white/10 hover:text-foreground focus-visible:outline focus-visible:outline-white/40 disabled:pointer-events-none disabled:opacity-40"
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
        <div className="mb-2 flex items-center justify-between gap-3">
          <h2
            id="persona-picker-heading"
            className="px-1 text-sm font-medium text-neutral-400"
          >
            {configuring ? "Configure personas" : "Who would you like to talk to?"}
          </h2>
          {canManage && (
            <button
              type="button"
              aria-label="Configure personas"
              aria-pressed={configuring}
              onClick={toggleConfiguring}
              disabled={busy}
              className={`flex size-8 shrink-0 items-center justify-center rounded-full transition-colors focus-visible:outline focus-visible:outline-white/40 disabled:pointer-events-none disabled:opacity-40 ${configuring
                  ? "bg-white/10 text-foreground"
                  : "text-neutral-400 hover:bg-white/10 hover:text-foreground"
                }`}
            >
              <svg
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth={2}
                strokeLinecap="round"
                strokeLinejoin="round"
                className={`size-5 transition-transform duration-300 ease-out motion-reduce:transition-none ${configuring ? "rotate-90" : ""
                  }`}
                aria-hidden="true"
              >
                <path d="M12.22 2h-.44a2 2 0 0 0-2 2v.18a2 2 0 0 1-1 1.73l-.43.25a2 2 0 0 1-2 0l-.15-.08a2 2 0 0 0-2.73.73l-.22.38a2 2 0 0 0 .73 2.73l.15.1a2 2 0 0 1 1 1.72v.51a2 2 0 0 1-1 1.74l-.15.09a2 2 0 0 0-.73 2.73l.22.38a2 2 0 0 0 2.73.73l.15-.08a2 2 0 0 1 2 0l.43.25a2 2 0 0 1 1 1.73V20a2 2 0 0 0 2 2h.44a2 2 0 0 0 2-2v-.18a2 2 0 0 1 1-1.73l.43-.25a2 2 0 0 1 2 0l.15.08a2 2 0 0 0 2.73-.73l.22-.39a2 2 0 0 0-.73-2.73l-.15-.08a2 2 0 0 1-1-1.74v-.5a2 2 0 0 1 1-1.74l.15-.09a2 2 0 0 0 .73-2.73l-.22-.38a2 2 0 0 0-2.73-.73l-.15.08a2 2 0 0 1-2 0l-.43-.25a2 2 0 0 1-1-1.73V4a2 2 0 0 0-2-2z" />
                <circle cx="12" cy="12" r="3" />
              </svg>
            </button>
          )}
        </div>
        {/* Space for the add button is always reserved, so configure mode
            never shifts the list; the button only fades in and out. */}
        {canManage && (
          <div className="mb-2 flex h-8">
            <button
              type="button"
              inert={!configuring}
              aria-label="Add persona"
              onClick={() => setAdding(true)}
              disabled={busy}
              className={`flex h-8 w-full items-center self-stretch justify-center rounded-2xl border border-white/5 bg-white/5 text-neutral-300 transition-[background-color,border-color,color,opacity,translate] duration-300 ease-out hover:border-white/20 hover:bg-white/10 hover:text-foreground focus-visible:outline focus-visible:outline-white/40 disabled:pointer-events-none motion-reduce:transition-none ${!configuring ? "-translate-y-1 opacity-0" : busy ? "opacity-40" : "translate-y-0 opacity-100"
                }`}
            >
              <svg
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth={3}
                strokeLinecap="round"
                className="size-4"
                aria-hidden="true"
              >
                <path d="M12 5v14M5 12h14" />
              </svg>
            </button>
          </div>
        )}
        {configuring && adding && (
          <AddPersonaForm
            onAdded={(persona) => {
              onAdd(persona);
              setAdding(false);
            }}
            onCancel={() => setAdding(false)}
            onWorkingChange={setBusy}
          />
        )}
        {notice && (
          <p role="status" className="px-1 pb-2 text-sm text-amber-400">
            {notice}
          </p>
        )}
        {personas.length === 0 && (
          <p className="px-1 py-3 text-sm text-neutral-500">No personas left.</p>
        )}
        {/* Pulled out to the panel's edges so the scrollbar sits at the border
            and row outlines aren't clipped by the scroll area. */}
        <ul
          {...listFade}
          className="scroll-fade -mx-5 -mb-5 flex min-h-0 flex-col gap-2 overflow-y-auto px-5 pt-0.5 pb-5"
        >
          {personas.map((persona) => {
            const selected = persona.id === selectedId;
            const showTalkTo = selected && !configuring;
            const removable = persona.origin === "user";
            return (
              <li
                key={persona.id}
                className={`flex items-center rounded-2xl border transition-colors ${selected
                    ? "border-white/25 bg-white/10"
                    : `border-white/5 bg-white/5 ${configuring ? "" : "hover:border-white/20 hover:bg-white/10"
                    }`
                  }`}
                onClick={() => !configuring && setSelectedId(persona.id)}
              >
                <button
                  type="button"
                  aria-pressed={selected}
                  disabled={configuring}
                  className="flex min-w-0 flex-1 flex-col items-start gap-0.5 self-stretch rounded-2xl px-4 py-3 text-left focus-visible:outline focus-visible:outline-white/40"
                >
                  <span className="font-medium text-foreground">{persona.name}</span>
                  <span className="text-sm text-neutral-500">{persona.description}</span>
                </button>
                {/* Fixed-width slot reserved on every row, so selecting a persona
                    never reflows its text. "Talk to" and the delete button share
                    the slot, stacked in one grid cell, and cross-fade within it. */}
                <div className="grid w-32 shrink-0 items-center justify-items-end pr-3">
                  <button
                    type="button"
                    inert={!showTalkTo}
                    aria-label={`Talk to ${persona.name}`}
                    onClick={() => onConfirm(persona)}
                    className={`group col-start-1 row-start-1 flex items-center gap-1.5 whitespace-nowrap rounded-full bg-neutral-100 py-1.5 pl-4 pr-3 text-sm font-medium text-neutral-900 transition-[background-color,opacity,translate] duration-300 ease-out hover:bg-white focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white/60 motion-reduce:transition-none ${showTalkTo ? "translate-x-0 opacity-100" : "translate-x-3 opacity-0"
                      }`}
                  >
                    Talk to
                    <svg
                      viewBox="0 0 24 24"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth={2.25}
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      className="size-4 transition-transform duration-200 ease-out group-hover:translate-x-0.5 motion-reduce:transition-none"
                      aria-hidden="true"
                    >
                      <path d="M5 12h14M13 6l6 6-6 6" />
                    </svg>
                  </button>
                  <button
                    type="button"
                    inert={!configuring}
                    aria-disabled={!removable || undefined}
                    aria-label={removable ? `Delete ${persona.name}` : `${persona.name} is built in and can't be removed`}
                    title={removable ? undefined : "Built-in personas can't be removed"}
                    disabled={busy}
                    onClick={() => removable && onDelete(persona)}
                    className={`col-start-1 row-start-1 flex size-9 items-center justify-center rounded-full transition-[background-color,opacity,translate] duration-300 ease-out focus-visible:outline-2 focus-visible:outline-offset-2 motion-reduce:transition-none ${removable
                        ? "text-red-500 hover:bg-red-500/15 focus-visible:outline-red-500/60"
                        : "cursor-not-allowed text-neutral-600 focus-visible:outline-white/40"
                      } ${configuring ? "translate-x-0 opacity-100" : "translate-x-3 opacity-0"} disabled:pointer-events-none disabled:opacity-40`}
                  >
                    <svg
                      viewBox="0 0 24 24"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth={2}
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      className="size-5"
                      aria-hidden="true"
                    >
                      <path d="M3 6h18M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6M10 11v6M14 11v6" />
                    </svg>
                  </button>
                </div>
              </li>
            );
          })}
        </ul>
      </section>
    </div>
  );
}
