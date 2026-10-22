import { speechLocale } from "@/lib/voice";

/** Spec §33.4: whether this browser has speech recognition (Chrome and Safari do; Firefox does not). */
export function speechSupported(): boolean {
  return typeof window !== "undefined" && ("SpeechRecognition" in window || "webkitSpeechRecognition" in window);
}

type RecognitionResultEvent = {
  resultIndex: number;
  results: ArrayLike<ArrayLike<{ transcript: string }> & { isFinal: boolean }>;
};

/** The part of the browser's SpeechRecognition a speech turn uses, so tests can fake it. */
export type RecognitionLike = {
  lang: string;
  continuous: boolean;
  interimResults: boolean;
  start(): void;
  stop(): void;
  abort(): void;
  onresult: ((event: RecognitionResultEvent) => void) | null;
  onerror: ((event: { error: string }) => void) | null;
  onend: (() => void) | null;
  /** Fires once the browser is listening, after any permission prompt. */
  onstart: (() => void) | null;
  /** Fires when the browser detects a voice, ~1 s before the first words come back. */
  onspeechstart: (() => void) | null;
};

export type SpeechResult = { text: string } | { error: "denied" | "failed" };

/** A new recognition in this language's speech locale ("pt" → "pt-BR"); null where the browser has none. */
export function createRecognition(lang: string): RecognitionLike | null {
  if (typeof window === "undefined") return null;
  const w = window as unknown as Record<string, (new () => RecognitionLike) | undefined>;
  const Ctor = w.SpeechRecognition ?? w.webkitSpeechRecognition;
  if (!Ctor) return null;
  const recognition = new Ctor();
  recognition.lang = speechLocale(lang) ?? lang;
  return recognition;
}

/**
 * The transcript of a continuous session's results. Desktop Chrome lists each phrase once; Android Chrome
 * adds a result with the whole sentence so far for every new word ("I'm", "I'm fine", "I'm fine today"…)
 * and keeps the earlier ones, so a result that starts with the previous one's words replaces it.
 */
function joinResults(transcripts: string[]): string {
  const words = (text: string) => text.toLowerCase().split(/\s+/).filter(Boolean);
  const phrases: string[] = [];
  for (const transcript of transcripts) {
    const text = transcript.trim();
    if (!text) continue;
    const previous = phrases.at(-1);
    const next = words(text);
    if (previous !== undefined && words(previous).every((word, i) => next[i] === word)) {
      phrases[phrases.length - 1] = text;
    } else {
      phrases.push(text);
    }
  }
  return phrases.join(" ");
}

type Timers = { setTimeout: (fn: () => void, ms: number) => unknown; clearTimeout: (id: unknown) => void };

/**
 * Spec §33.4: one spoken turn. It ends after `silenceMs` without a new result, after `firstWordMs` when
 * nothing is heard (Chrome returns the first word ~1.5 s after speech starts), `maxMs` after the voice
 * is detected (`onspeechstart`, else the first word; so a pause before speaking doesn't cut the time to
 * talk, and `elapsed()` counts from there too), on
 * `stop()` (a tap), or when the browser ends the session; it resolves once, with the transcript heard
 * (interim results included), trimmed. A tap or a clock stops the recognition and then waits, at most
 * `drainMs`, for the browser to end, so the words it is still processing aren't lost. The clocks start
 * when the recognition does (`onstart`), so the first tap's permission prompt doesn't use them up; one
 * that never starts within `startMs` fails.
 */
export function createSpeechTurn(opts: {
  recognition: RecognitionLike;
  silenceMs?: number;
  firstWordMs?: number;
  maxMs?: number;
  startMs?: number;
  drainMs?: number;
  timers?: Timers;
  now?: () => number;
  /** Called on every recognition result; the sound-level bars use it when the mic can't be read. */
  onResult?: () => void;
}): { done: Promise<SpeechResult>; stop(): void; elapsed(): number } {
  const { recognition, silenceMs = 3000, firstWordMs = 8000, maxMs = 10_000, startMs = 15_000, drainMs = 2000 } =
    opts;
  const timers: Timers = opts.timers ?? {
    setTimeout: (fn, ms) => setTimeout(fn, ms),
    clearTimeout: (id) => clearTimeout(id as ReturnType<typeof setTimeout>),
  };
  const now = opts.now ?? (() => Date.now());
  let started = false;
  let speakingAt: number | null = null;
  let endedAt: number | null = null;
  let transcript = "";
  let settled = false;
  let draining = false;
  let resolve!: (result: SpeechResult) => void;
  const done = new Promise<SpeechResult>((r) => (resolve = r));

  let silence: unknown = null;
  const markSpeaking = () => {
    if (speakingAt !== null || draining || settled) return;
    speakingAt = now();
    timers.clearTimeout(total);
    total = timers.setTimeout(drain, maxMs);
  };
  let drainTimer: unknown = null;
  let total: unknown = timers.setTimeout(() => finish({ error: "failed" }, true), startMs);
  const restartSilence = (ms = silenceMs) => {
    if (silence !== null) timers.clearTimeout(silence);
    silence = timers.setTimeout(drain, ms);
  };

  /** Stops listening, then sends once the browser ends (with its last words) or `drainMs` passes. */
  function drain() {
    if (settled || draining) return;
    draining = true;
    endedAt = now();
    timers.clearTimeout(total);
    if (silence !== null) timers.clearTimeout(silence);
    drainTimer = timers.setTimeout(() => finish({ text: transcript }, false), drainMs);
    try {
      recognition.stop();
    } catch {
      finish({ text: transcript }, false);
    }
  }

  function finish(result: SpeechResult, stopRecognition: boolean) {
    if (settled) return;
    settled = true;
    endedAt ??= now();
    timers.clearTimeout(total);
    if (silence !== null) timers.clearTimeout(silence);
    if (drainTimer !== null) timers.clearTimeout(drainTimer);
    recognition.onresult = null;
    recognition.onerror = null;
    recognition.onend = null;
    recognition.onstart = null;
    recognition.onspeechstart = null;
    if (stopRecognition) {
      try {
        recognition.stop();
      } catch {
        // Already stopped.
      }
    }
    resolve("text" in result ? { text: result.text.replace(/\s+/g, " ").trim() } : result);
  }

  recognition.continuous = true;
  recognition.interimResults = true;
  recognition.onresult = (event) => {
    // Continuous mode lists every phrase of the session, so the transcript is rebuilt from all of them.
    transcript = joinResults(Array.from(event.results, (r) => r[0]?.transcript ?? ""));
    if (draining) return;
    markSpeaking();
    restartSilence();
    opts.onResult?.();
  };
  recognition.onerror = (event) => {
    if (event.error === "not-allowed" || event.error === "service-not-allowed") finish({ error: "denied" }, false);
    else if (event.error === "no-speech" || event.error === "aborted") finish({ text: transcript }, false);
    else finish({ error: "failed" }, false);
  };
  recognition.onend = () => finish({ text: transcript }, false);
  recognition.onspeechstart = markSpeaking;
  recognition.onstart = () => {
    if (started) return;
    started = true;
    timers.clearTimeout(total);
    restartSilence(firstWordMs);
  };
  try {
    recognition.start();
  } catch {
    finish({ error: "failed" }, false);
  }

  return {
    done,
    stop: drain,
    elapsed: () => (speakingAt === null ? 0 : (endedAt ?? now()) - speakingAt),
  };
}
