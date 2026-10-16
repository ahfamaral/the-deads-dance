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

type Timers = { setTimeout: (fn: () => void, ms: number) => unknown; clearTimeout: (id: unknown) => void };

/**
 * Spec §33.4: one spoken turn. It ends after `silenceMs` without a new result (also when nothing is
 * said), at `maxMs` in all, on `stop()` (a tap), or when the browser ends the session; it resolves
 * once, with the transcript heard so far (interim results included), trimmed. The clocks start when
 * the recognition does (`onstart`), so the first tap's permission prompt doesn't use them up; one
 * that never starts within `startMs` fails.
 */
export function createSpeechTurn(opts: {
  recognition: RecognitionLike;
  silenceMs?: number;
  maxMs?: number;
  startMs?: number;
  timers?: Timers;
  now?: () => number;
  /** Called on every recognition result; the sound-level bars use it when the mic can't be read. */
  onResult?: () => void;
}): { done: Promise<SpeechResult>; stop(): void; elapsed(): number } {
  const { recognition, silenceMs = 3000, maxMs = 10_000, startMs = 15_000 } = opts;
  const timers: Timers = opts.timers ?? {
    setTimeout: (fn, ms) => setTimeout(fn, ms),
    clearTimeout: (id) => clearTimeout(id as ReturnType<typeof setTimeout>),
  };
  const now = opts.now ?? (() => Date.now());
  let startedAt: number | null = null;
  let endedAt: number | null = null;
  let transcript = "";
  let settled = false;
  let resolve!: (result: SpeechResult) => void;
  const done = new Promise<SpeechResult>((r) => (resolve = r));

  let silence: unknown = null;
  let total: unknown = timers.setTimeout(() => finish({ error: "failed" }, true), startMs);
  const restartSilence = () => {
    if (silence !== null) timers.clearTimeout(silence);
    silence = timers.setTimeout(() => finish({ text: transcript }, true), silenceMs);
  };

  function finish(result: SpeechResult, stopRecognition: boolean) {
    if (settled) return;
    settled = true;
    endedAt = now();
    timers.clearTimeout(total);
    if (silence !== null) timers.clearTimeout(silence);
    recognition.onresult = null;
    recognition.onerror = null;
    recognition.onend = null;
    recognition.onstart = null;
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
    transcript = Array.from(event.results, (r) => r[0]?.transcript ?? "").join(" ");
    restartSilence();
    opts.onResult?.();
  };
  recognition.onerror = (event) => {
    if (event.error === "not-allowed" || event.error === "service-not-allowed") finish({ error: "denied" }, false);
    else if (event.error === "no-speech" || event.error === "aborted") finish({ text: transcript }, false);
    else finish({ error: "failed" }, false);
  };
  recognition.onend = () => finish({ text: transcript }, false);
  recognition.onstart = () => {
    if (startedAt !== null) return;
    startedAt = now();
    timers.clearTimeout(total);
    total = timers.setTimeout(() => finish({ text: transcript }, true), maxMs);
    restartSilence();
  };
  try {
    recognition.start();
  } catch {
    finish({ error: "failed" }, false);
  }

  return {
    done,
    stop: () => finish({ text: transcript }, true),
    elapsed: () => (startedAt === null ? 0 : (endedAt ?? now()) - startedAt),
  };
}
