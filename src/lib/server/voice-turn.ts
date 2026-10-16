import type { CostLedger } from "@corpus/cost-ledger";
import type { ChatStreamEvent } from "@/lib/chat-types";
import { createChunker } from "./speech-chunks";
import { PCM_SAMPLE_RATE, type Speak } from "./tts";

/** Spec §33.5: speech calls running at once for one reply. */
const MAX_IN_FLIGHT = 2;
/** Spec §33.5: no speech call starts this long after the request began (the route may run 120 s). */
export const SPEECH_DEADLINE_MS = 95_000;

export type SpeakReplyOptions = {
  /** The conversation's stored voice; null when it was deleted since the first turn. */
  voice: { baseVoice: string; instructions: string } | null;
  speak: Speak;
  /** Each speech call is recorded here, so the turn's settle charges it (spec §26.4). */
  ledger: CostLedger;
  /** False once the browser is gone: no new speech call starts (calls already made are charged). */
  listening: () => boolean;
  /** The clock, for tests. */
  now?: () => number;
  /** Time left for new speech calls, counted from the first event read; the rest of the reply then loses its voice. */
  deadlineMs?: number;
};

/**
 * Spec §33.5: passes every event through and speaks the reply as it streams. The token text is
 * cut into chunks (first sentence first); each chunk is one speech call, at most two at a time,
 * and their audio goes out in seq order as it is ready, between the other events. The last chunk
 * goes at `done`, which passes through when it arrives; the stream ends once every call settles.
 * After a failed call (or with no voice, or past the deadline) one `audio_error` is sent and nothing more is spoken.
 */
export async function* speakReply(events: AsyncIterable<ChatStreamEvent>, opts: SpeakReplyOptions): AsyncGenerator<ChatStreamEvent> {
  const { voice, speak, ledger, listening, now = Date.now, deadlineMs = SPEECH_DEADLINE_MS } = opts;
  const deadline = now() + deadlineMs;
  const chunker = createChunker();
  const out: ChatStreamEvent[] = [];
  const waiting: string[] = [];
  const ready = new Map<number, Buffer>();
  let nextSeq = 0;
  let nextToSend = 0;
  let inFlight = 0;
  let lost = false;
  let upstreamDone = false;
  let upstreamError: unknown = null;
  let wake: (() => void) | null = null;
  const notify = () => {
    wake?.();
    wake = null;
  };

  const loseVoice = () => {
    if (lost) return;
    lost = true;
    waiting.length = 0;
    out.push({ type: "audio_error" });
  };

  // Audio is sent in seq order; once the voice is lost, audio still arriving is dropped.
  const sendReady = () => {
    while (ready.has(nextToSend)) {
      const pcm = ready.get(nextToSend)!;
      ready.delete(nextToSend);
      if (!lost) out.push({ type: "audio", seq: nextToSend, data: pcm.toString("base64"), sampleRate: PCM_SAMPLE_RATE });
      nextToSend++;
    }
  };

  const startCalls = () => {
    while (voice && !lost && inFlight < MAX_IN_FLIGHT && waiting.length > 0 && listening()) {
      if (now() >= deadline) {
        loseVoice();
        return;
      }
      const text = waiting.shift()!;
      const seq = nextSeq++;
      inFlight++;
      // Any throw, from the call or from handling its result, loses the voice; the chain never rejects, so the stream always ends.
      speak({ text, voice: voice.baseVoice, instructions: voice.instructions })
        .then(({ pcm, call }) => {
          ledger.record(call);
          ready.set(seq, pcm);
          sendReady();
        })
        .catch((err) => {
          console.error(err); // tts.ts has already retried once
          loseVoice();
        })
        .finally(() => {
          inFlight--;
          try {
            startCalls();
          } finally {
            notify();
          }
        })
        .catch((err) => console.error(err));
    }
  };

  const queue = (chunks: (string | null)[]) => {
    for (const c of chunks) if (c) waiting.push(c);
    startCalls();
  };

  void (async () => {
    try {
      for await (const event of events) {
        out.push(event);
        if (event.type === "token") queue(chunker.push(event.text));
        if (event.type === "done") {
          if (voice) queue([chunker.flush()]);
          else loseVoice();
        }
        notify();
      }
    } catch (err) {
      upstreamError = err;
    } finally {
      upstreamDone = true;
      notify();
    }
  })();

  for (;;) {
    if (out.length > 0) {
      yield out.shift()!;
      continue;
    }
    if (upstreamDone && inFlight === 0) break;
    await new Promise<void>((resolve) => (wake = resolve));
  }
  if (upstreamError) throw upstreamError;
}
