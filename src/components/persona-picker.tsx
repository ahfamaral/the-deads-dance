"use client";

import { useState, useSyncExternalStore } from "react";
import AddPersonaForm from "@/components/add-persona-form";
import GearIcon from "@/components/gear-icon";
import VoiceIcon from "@/components/voice-icon";
import EnergyBar from "@/components/energy-bar";
import EnergyNotice from "@/components/energy-notice";
import SpendBadge from "@/components/spend-badge";
import { dueBanner, type BannerThreshold } from "@/lib/energy";
import { isOutOfEnergy, type Meter } from "@/lib/meter";
import type { Persona } from "@/lib/personas";
import { speechSupported } from "@/lib/speech-input";
import { useScrollFade } from "@/lib/use-scroll-fade";

type PersonaPickerProps = {
  personas: Persona[];
  canManage: boolean;
  notice: string | null;
  onConfirm: (persona: Persona) => void;
  onDelete: (persona: Persona) => void;
  /** 2026-10-16: hide a persona from testers' picker, or show it again (admin). */
  onToggleHidden: (persona: Persona) => void;
  /** Spec §33.3: open the admin's Voice panel for a persona. */
  onEditVoice: (persona: Persona) => void;
  onAdd: (persona: Persona) => void;
  onBack: () => void;
  /** Spec §26.5: the tester's energy, or the admin's spend today; null if it couldn't be read. */
  meter: Meter | null;
  onDismissBanner: (threshold: BannerThreshold) => void;
  /** Tests only: stands in for the browser check, which otherwise runs after mount. */
  voiceSupported?: boolean;
};

const subscribeNoop = () => () => {};

/**
 * Lets the user choose who to talk to. Selecting a persona reveals a
 * "Talk to" button on its row, which confirms the choice. The gear toggles a
 * configure mode that swaps "Talk to" for a hide and a delete button and shows an
 * "add persona" button under the gear, which opens a form that adds a
 * persona from a Wikipedia title. Built-in personas show a disabled trash icon.
 * While a persona is being added, every other button in the panel is disabled.
 */
export default function PersonaPicker({ personas, canManage, notice, onConfirm, onDelete, onToggleHidden, onEditVoice, onAdd, onBack, meter, onDismissBanner, voiceSupported }: PersonaPickerProps) {
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [configuring, setConfiguring] = useState(false);
  const [adding, setAdding] = useState(false);
  const [busy, setBusy] = useState(false);
  // Spec §33.4: false until mounted, so the server markup never has the voice icon.
  const speechOk = useSyncExternalStore(subscribeNoop, speechSupported, () => false);
  const showVoiceIcon = voiceSupported ?? speechOk;
  const listFade = useScrollFade();
  const banner = meter?.kind === "energy" ? dueBanner(meter.left, meter.warningRead) : null;
  const outOfEnergy = isOutOfEnergy(meter);

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
        className="flex max-h-full w-full max-w-md flex-col overflow-hidden rounded-3xl border border-white/10 bg-neutral-900/80 p-5 shadow-lg shadow-black/40 pointer-coarse:bg-neutral-900/90 pointer-fine:backdrop-blur-md"
      >
        <div className="-ml-2 mb-3 flex items-center justify-between gap-3">
        <button
          type="button"
          onClick={onBack}
          disabled={busy}
          className="flex items-center gap-1.5 min-h-11 rounded-full px-3 py-1.5 text-base text-neutral-400 sm:text-sm transition-colors hover:bg-white/10 hover:text-foreground focus-visible:outline focus-visible:outline-white/40 disabled:pointer-events-none disabled:opacity-40"
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
          {meter?.kind === "energy" && <EnergyBar left={meter.left} />}
          {meter?.kind === "spend" && <SpendBadge spend={meter.today} suffix="today" />}
        </div>
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
              className={`relative flex size-8 shrink-0 items-center after:absolute after:-inset-1.5 justify-center rounded-full transition-colors focus-visible:outline focus-visible:outline-white/40 disabled:pointer-events-none disabled:opacity-40 ${configuring
                  ? "bg-white/10 text-foreground"
                  : "text-neutral-400 hover:bg-white/10 hover:text-foreground"
                }`}
            >
              <GearIcon open={configuring} />
            </button>
          )}
        </div>
        {banner !== null && <EnergyNotice threshold={banner} onDismiss={() => onDismissBanner(banner)} className="mb-2 rounded-xl" />}
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
              className={`flex h-11 w-full items-center self-stretch sm:h-8 justify-center rounded-2xl border border-white/5 bg-white/5 text-neutral-300 transition-[background-color,border-color,color,opacity,translate] duration-300 ease-out hover:border-white/20 hover:bg-white/10 hover:text-foreground focus-visible:outline focus-visible:outline-white/40 disabled:pointer-events-none motion-reduce:transition-none ${!configuring ? "-translate-y-1 opacity-0" : busy ? "opacity-40" : "translate-y-0 opacity-100"
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
            onCreateVoice={onEditVoice}
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
                // The keyboard focus ring sits on the card, not on the inner row button (a second border inside the card).
                className={`flex items-center rounded-2xl border transition-colors has-[>button:focus-visible]:outline has-[>button:focus-visible]:outline-white/40 ${selected
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
                  className="flex min-w-0 flex-1 flex-col items-start gap-0.5 self-stretch rounded-2xl px-4 py-3 text-left outline-none"
                >
                  <span className={`font-medium text-foreground ${persona.hidden ? "opacity-60" : ""}`}>
                    {persona.name}
                    {showVoiceIcon && persona.voiceLanguages.length > 0 && <VoiceIcon />}
                    {persona.hidden && (
                      <span className="ml-2 rounded-full border border-white/15 px-2 py-0.5 align-middle text-xs font-normal text-neutral-400">Hidden</span>
                    )}
                  </span>
                  <span className={`text-sm text-neutral-500 ${persona.hidden ? "opacity-60" : ""}`}>{persona.description}</span>
                </button>
                {/* Fixed-width slot reserved on every row, so selecting a persona
                    never reflows its text. "Talk to" and the delete button share
                    the slot, stacked in one grid cell, and cross-fade within it. */}
                <div className="grid min-w-32 shrink-0 items-center justify-items-end pr-2">
                  <button
                    type="button"
                    inert={!showTalkTo}
                    aria-label={`Talk to ${persona.name}`}
                    onClick={() => onConfirm(persona)}
                    disabled={configuring || outOfEnergy}
                    className={`group col-start-1 row-start-1 flex items-center gap-1.5 min-h-11 whitespace-nowrap rounded-full bg-neutral-100 py-1.5 pl-4 pr-3 text-base font-medium sm:min-h-0 sm:text-sm text-neutral-900 transition-[background-color,opacity,translate] duration-300 ease-out hover:bg-white focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white/60 motion-reduce:transition-none ${showTalkTo ? "translate-x-0 opacity-100 disabled:pointer-events-none disabled:opacity-40" : "translate-x-3 opacity-0"
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
                  {/* Config mode: hide (2026-10-16) left of delete; both fade in together. */}
                  <div
                    inert={!configuring}
                    className={`col-start-1 row-start-1 flex items-center gap-0 transition-[opacity,translate] duration-300 ease-out motion-reduce:transition-none ${configuring ? "translate-x-0 opacity-100" : "translate-x-3 opacity-0"}`}
                  >
                  {canManage && (
                    <button
                      type="button"
                      aria-pressed={persona.hidden}
                      aria-label={persona.hidden ? `Show ${persona.name}` : `Hide ${persona.name}`}
                      title={persona.hidden ? "Hidden from testers. Show again" : "Hide from testers"}
                      disabled={busy}
                      onClick={() => onToggleHidden(persona)}
                      className="flex size-11 items-center justify-center rounded-full text-neutral-300 transition-colors hover:bg-white/10 hover:text-foreground focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white/40 disabled:pointer-events-none disabled:opacity-40"
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
                        {persona.hidden ? (
                          <path d="M3 3l18 18M10.6 10.6a2 2 0 0 0 2.8 2.8M9.9 5.1A9.8 9.8 0 0 1 12 5c6.5 0 10 7 10 7a17.6 17.6 0 0 1-3.2 4.2M6.6 6.6C3.9 8.4 2 12 2 12s3.5 7 10 7a9.7 9.7 0 0 0 5.4-1.6" />
                        ) : (
                          <path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12zM12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6z" />
                        )}
                      </svg>
                    </button>
                  )}
                  {canManage && (
                    <button
                      type="button"
                      aria-label={`Voice for ${persona.name}`}
                      title="Design the voice"
                      disabled={busy}
                      onClick={() => onEditVoice(persona)}
                      className="flex size-11 items-center justify-center rounded-full text-neutral-300 transition-colors hover:bg-white/10 hover:text-foreground focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white/40 disabled:pointer-events-none disabled:opacity-40"
                    >
                      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" className="size-5" aria-hidden="true">
                        <path d="M11 5 6 9H2v6h4l5 4z" />
                        <path d="M15.5 8.5a5 5 0 0 1 0 7" />
                        <path d="M19 5a10 10 0 0 1 0 14" />
                      </svg>
                    </button>
                  )}
                  <button
                    type="button"
                    aria-disabled={!removable || undefined}
                    aria-label={removable ? `Delete ${persona.name}` : `${persona.name} is built in and can't be removed`}
                    title={removable ? undefined : "Built-in personas can't be removed"}
                    disabled={busy}
                    onClick={() => removable && onDelete(persona)}
                    className={`flex size-11 items-center justify-center rounded-full transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 ${removable
                        ? "text-red-500 hover:bg-red-500/15 focus-visible:outline-red-500/60"
                        : "cursor-not-allowed text-neutral-600 focus-visible:outline-white/40"
                      } disabled:pointer-events-none disabled:opacity-40`}
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
                </div>
              </li>
            );
          })}
        </ul>
      </section>
    </div>
  );
}
