"use client";

import { useEffect, useRef, useState, type KeyboardEvent } from "react";
import { GEMINI_VOICES } from "@/lib/voice";

type Sex = "male" | "female";
type Props = {
  value: string;
  onChange: (name: string) => void;
  /** The persona's sex: its group of voices is listed first. Unknown lists Male first. */
  sex: Sex | null;
  disabled?: boolean;
  id?: string;
  /** For tests: renders with the list open. */
  initialOpen?: boolean;
};

const ROW = "flex min-h-11 w-full cursor-pointer items-center gap-2 px-3 py-2 text-left text-base outline-none hover:bg-white/10 focus-visible:bg-white/10 sm:text-sm";

function Chevron({ open }: { open: boolean }) {
  return (
    <svg
      data-chevron=""
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
      className={`size-4 shrink-0 text-neutral-400 transition-transform motion-reduce:transition-none ${open ? "rotate-180" : ""}`}
      aria-hidden="true"
    >
      <path d="M6 9l6 6 6-6" />
    </svg>
  );
}

function Check() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" className="size-4 shrink-0" aria-hidden="true">
      <path d="M5 12l5 5L20 7" />
    </svg>
  );
}

/** Spec §33.3: the base voice, chosen from a list that opens inside the panel, grouped by gender. */
export default function BaseVoicePicker({ value, onChange, sex, disabled = false, id, initialOpen = false }: Props) {
  const [openState, setOpen] = useState(initialOpen);
  const open = openState && !disabled;
  const [active, setActive] = useState(0);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const optionRefs = useRef<(HTMLLIElement | null)[]>([]);
  const order: Sex[] = sex === "female" ? ["female", "male"] : ["male", "female"];
  const groups = order.map((gender) => ({ gender, voices: GEMINI_VOICES.filter((v) => v.gender === gender) }));
  const flat = groups.flatMap((g) => g.voices);
  const current = GEMINI_VOICES.find((v) => v.name === value);

  function openList() {
    setActive(Math.max(0, flat.findIndex((v) => v.name === value)));
    setOpen(true);
  }
  useEffect(() => {
    if (open) optionRefs.current[active]?.focus();
  }, [open, active]);

  function close() {
    setOpen(false);
    triggerRef.current?.focus();
  }
  function choose(name: string) {
    onChange(name);
    close();
  }
  function onKeyDown(event: KeyboardEvent) {
    if (event.key === "Escape") {
      event.preventDefault();
      event.stopPropagation();
      close();
    } else if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      event.preventDefault();
      setActive((i) => Math.min(flat.length - 1, Math.max(0, i + (event.key === "ArrowDown" ? 1 : -1))));
    } else if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      choose(flat[active].name);
    }
  }

  let index = -1;
  return (
    <div className="flex flex-col gap-1" onKeyDown={open ? onKeyDown : undefined}>
      <button
        ref={triggerRef}
        id={id}
        type="button"
        aria-haspopup="listbox"
        aria-expanded={open}
        disabled={disabled}
        onClick={() => (open ? close() : openList())}
        className="flex min-h-11 w-full items-center justify-between gap-2 rounded-2xl border border-white/10 bg-neutral-950/60 py-2 pr-4 pl-3 text-left text-base text-foreground focus-visible:outline focus-visible:outline-white/40 disabled:opacity-40 sm:text-sm"
      >
        <span>{current ? `${current.name} · ${current.character}` : value}</span>
        <Chevron open={open} />
      </button>
      {open && (
        <ul role="listbox" aria-label="Base voice" className="max-h-72 overflow-y-auto rounded-2xl border border-white/10 bg-neutral-950/60 py-1">
          {groups.map((g) => (
            <li key={g.gender} role="presentation">
              <p className="px-3 pt-2 pb-1 text-xs text-neutral-400">{g.gender === "male" ? "Male voices" : "Female voices"}</p>
              <ul role="group" aria-label={g.gender === "male" ? "Male voices" : "Female voices"}>
                {g.voices.map((v) => {
                  index += 1;
                  const i = index;
                  return (
                    <li
                      key={v.name}
                      ref={(el) => {
                        optionRefs.current[i] = el;
                      }}
                      role="option"
                      aria-selected={v.name === value}
                      tabIndex={i === active ? 0 : -1}
                      onClick={() => choose(v.name)}
                      className={ROW}
                    >
                      <span className="font-medium">{v.name}</span>
                      <span className="flex-1 text-neutral-400">{v.character}</span>
                      {v.name === value && <Check />}
                    </li>
                  );
                })}
              </ul>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
