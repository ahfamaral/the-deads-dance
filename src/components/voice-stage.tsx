"use client";

import { useEffect, useRef } from "react";
import VoiceOrb from "@/components/voice-orb";
import type { VoiceStageView } from "@/lib/voice-stage-state";

/** The listening ring's circumference (r = 38 in an 82 × 82 box), for its dash. */
const RING_LENGTH = 2 * Math.PI * 38;
const MAX_LISTEN_MS = 10_000;
/** The resting shape of the sound-level bars (mockup v5), scaled by the mic's level. */
const BAR_HEIGHTS = [6, 12, 16, 9, 13, 5, 10];

type VoiceStageProps = {
  personaName: string;
  /** "German": the conversation's voice language. */
  voiceLanguageName: string;
  state: VoiceStageView;
  /** Spec §33.5: the text of the answer whose voice was lost, until the next turn starts. */
  lostText: string | null;
  /** The answer's loudness, 0..1. */
  level: () => number;
  /** While listening: the time used (ms) and the mic's level, 0..1. */
  listen: { elapsed: () => number; micLevel: () => number };
  onMic: () => void;
  onStop: () => void;
  onRetry: () => void;
  onResume: () => void;
};

/** Runs `draw` on every animation frame while mounted. */
function useFrames(draw: (ms: number) => void) {
  const latest = useRef(draw);
  useEffect(() => {
    latest.current = draw;
  });
  useEffect(() => {
    let frame = 0;
    const tick = (ms: number) => {
      latest.current(ms);
      frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, []);
}

function MicIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" className="size-7" aria-hidden="true">
      <rect x="9" y="2" width="6" height="12" rx="3" />
      <path d="M19 10v1a7 7 0 0 1-14 0v-1" />
      <path d="M12 18v4" />
    </svg>
  );
}

/** Spec §33.4: the ring around the stop button fills over the 10 s a turn may last. */
function ListenRing({ elapsed }: { elapsed: () => number }) {
  const ref = useRef<SVGCircleElement>(null);
  useFrames(() => {
    const used = Math.min(1, elapsed() / MAX_LISTEN_MS);
    ref.current?.setAttribute("stroke-dashoffset", String(RING_LENGTH * (1 - used)));
  });
  return (
    <svg viewBox="0 0 82 82" className="pointer-events-none absolute -inset-[7px] size-[82px] -rotate-90" aria-hidden="true">
      <circle cx="41" cy="41" r="38" fill="none" stroke="rgba(255,255,255,.15)" strokeWidth="3" />
      <circle
        ref={ref}
        cx="41"
        cy="41"
        r="38"
        fill="none"
        stroke="#fff"
        strokeWidth="3"
        strokeLinecap="round"
        strokeDasharray={RING_LENGTH}
        strokeDashoffset={RING_LENGTH}
      />
    </svg>
  );
}

function LevelBars({ micLevel }: { micLevel: () => number }) {
  const bars = useRef<(HTMLElement | null)[]>([]);
  const smooth = useRef(0);
  useFrames((ms) => {
    smooth.current += (micLevel() - smooth.current) * 0.3;
    bars.current.forEach((bar, i) => {
      if (!bar) return;
      const wobble = 0.6 + 0.4 * Math.sin(ms / 90 + i * 1.7);
      bar.style.height = `${Math.max(3, BAR_HEIGHTS[i] * (0.2 + 0.8 * smooth.current * wobble))}px`;
    });
  });
  return (
    <div className="mt-1.5 flex h-4 items-end justify-center gap-[3px]" aria-hidden="true">
      {BAR_HEIGHTS.map((_, i) => (
        <i
          key={i}
          ref={(el) => {
            bars.current[i] = el;
          }}
          className="block w-[3px] rounded-sm bg-red-500"
          style={{ height: 3 }}
        />
      ))}
    </div>
  );
}

const BUTTON = "relative flex size-[68px] items-center justify-center rounded-full border focus-visible:outline focus-visible:outline-white/40";

/**
 * Spec §33.4: the voice screen, in place of the message list and the input. No text but the state
 * line, except the one answer whose voice was lost (§33.5). While it is shown the page background
 * is off; the circle carries it instead (§33.7).
 */
export default function VoiceStage({ personaName, voiceLanguageName, state, lostText, level, listen, onMic, onStop, onRetry, onResume }: VoiceStageProps) {
  useEffect(() => {
    document.body.dataset.voice = "on";
    return () => {
      delete document.body.dataset.voice;
    };
  }, []);

  const hint =
    state.button === "mic"
      ? state.kind === "resume"
        ? null
        : "Tap to talk"
      : state.button === "stop"
        ? "Tap to send"
        : state.button === "disabled"
          ? state.kind === "thinking" || state.kind === "speaking"
            ? "Wait for the answer"
            : "Out of energy"
          : null;

  return (
    <div className="flex min-h-0 flex-1 flex-col items-center overflow-y-auto px-4 pt-8 pb-6">
      {/* Phones: the name sits here, in full, instead of truncated in the header (2026-10-18). */}
      <h2 className="mb-5 max-w-full text-center text-lg font-medium text-foreground sm:hidden">{personaName}</h2>
      <VoiceOrb state={state.kind} level={level} />
      <p className="mt-3 text-xs text-neutral-500">An imagined voice · {voiceLanguageName}</p>
      <div role="status" className="mt-5 min-h-9 text-center text-sm text-neutral-300">
        {state.line}
        {state.kind === "listening" && <LevelBars micLevel={listen.micLevel} />}
      </div>
      {lostText !== null && (
        <div className="mt-2 max-w-md text-center text-sm text-neutral-200">
          {state.kind !== "lost" && <p className="mb-1 text-xs text-neutral-500">{personaName}&apos;s voice was lost for this answer.</p>}
          <p className="whitespace-pre-wrap">{lostText}</p>
        </div>
      )}
      <div className="mt-auto flex flex-col items-center gap-2 pt-6">
        {state.button === "stop" ? (
          <button type="button" onClick={onStop} aria-label="Stop and send" className={`${BUTTON} border-red-500 bg-red-500 text-white`}>
            <ListenRing elapsed={listen.elapsed} />
            <svg viewBox="0 0 24 24" fill="currentColor" className="size-7" aria-hidden="true">
              <rect x="7" y="7" width="10" height="10" rx="2" />
            </svg>
          </button>
        ) : state.button === "retry" ? (
          <button type="button" onClick={onRetry} className={`${BUTTON} border-white/20 bg-white/10 text-sm font-medium text-neutral-100 transition-colors hover:bg-white/20`}>
            Retry
          </button>
        ) : state.button === "mic" || state.button === "disabled" ? (
          <button
            type="button"
            onClick={state.kind === "resume" ? onResume : onMic}
            disabled={state.button === "disabled"}
            aria-label={state.kind === "resume" ? "Continue" : "Talk"}
            className={`${BUTTON} border-white/20 bg-white/10 text-neutral-100 transition-colors hover:bg-white/20 disabled:opacity-30 disabled:hover:bg-white/10`}
          >
            <MicIcon />
          </button>
        ) : null}
        {hint && <p className="text-xs text-neutral-500">{hint}</p>}
      </div>
    </div>
  );
}
