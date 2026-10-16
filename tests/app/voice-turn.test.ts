import { afterEach, describe, expect, it, vi } from "vitest";
import { CostLedger, type ModelCallRecord } from "@corpus/cost-ledger";
import type { ChatStreamEvent } from "@/lib/chat-types";
import { PCM_SAMPLE_RATE, type Speak } from "@/lib/server/tts";
import { speakReply } from "@/lib/server/voice-turn";

const ttsCall: ModelCallRecord = { role: "tts", model: "t", inputTokens: 20, outputTokens: 64, cost: null, generationId: null, latencyMs: 1 };
const PCM = Buffer.alloc(4800);
const VOICE = { baseVoice: "Algenib", instructions: "An old man, slow and warm." };
const DONE: ChatStreamEvent = { type: "done", message: { text: "Well. This is the rest of it.", toolCalls: [], sources: [] } };

async function* upstream(events: ChatStreamEvent[]): AsyncGenerator<ChatStreamEvent> {
  for (const e of events) yield e;
}
const reply = (...tokens: string[]): ChatStreamEvent[] => [...tokens.map((text) => ({ type: "token" as const, text })), DONE];
const TWO_CHUNKS = reply("Well. ", "This is the rest of it. ");

/** A speak whose calls resolve only when the test says so. */
function heldSpeak() {
  const pending: { text: string; resolve: () => void; reject: (e: Error) => void }[] = [];
  const speak = vi.fn<Speak>(
    ({ text }) =>
      new Promise((resolve, reject) => {
        pending.push({ text, resolve: () => resolve({ pcm: PCM, call: ttsCall }), reject });
      }),
  );
  return { speak, pending };
}

async function collect(gen: AsyncIterable<ChatStreamEvent>): Promise<ChatStreamEvent[]> {
  const out: ChatStreamEvent[] = [];
  for await (const e of gen) out.push(e);
  return out;
}

const audio = (seq: number): ChatStreamEvent => ({ type: "audio", seq, data: PCM.toString("base64"), sampleRate: PCM_SAMPLE_RATE });

afterEach(() => vi.restoreAllMocks());

describe("speakReply (spec §33.5)", () => {
  it("passes every event through and adds the audio in order, even when the second chunk is ready first", async () => {
    const { speak, pending } = heldSpeak();
    const ledger = new CostLedger();
    const out = collect(speakReply(upstream(TWO_CHUNKS), { voice: VOICE, speak, ledger, listening: () => true }));
    await vi.waitFor(() => expect(pending).toHaveLength(2));
    expect(pending.map((p) => p.text)).toEqual(["Well.", "This is the rest of it."]);
    pending[1].resolve();
    await new Promise((r) => setTimeout(r, 10));
    pending[0].resolve();
    const all = await out;
    expect(all.filter((e) => e.type !== "audio")).toEqual(TWO_CHUNKS);
    expect(all.filter((e) => e.type === "audio")).toEqual([audio(0), audio(1)]);
    expect(speak).toHaveBeenCalledWith({ text: "Well.", voice: "Algenib", instructions: VOICE.instructions });
    expect(ledger.calls).toEqual([ttsCall, ttsCall]);
  });

  it("keeps at most two calls in flight", async () => {
    const { speak, pending } = heldSpeak();
    const long = `${"a".repeat(200)}. `;
    const out = collect(speakReply(upstream(reply("Well. ", long, long)), { voice: VOICE, speak, ledger: new CostLedger(), listening: () => true }));
    await vi.waitFor(() => expect(pending).toHaveLength(2));
    await new Promise((r) => setTimeout(r, 10));
    expect(speak).toHaveBeenCalledTimes(2);
    pending[0].resolve();
    await vi.waitFor(() => expect(pending).toHaveLength(3));
    pending[1].resolve();
    pending[2].resolve();
    expect((await out).filter((e) => e.type === "audio").map((e) => (e as { seq: number }).seq)).toEqual([0, 1, 2]);
  });

  it("sends one audio_error when speech fails, and no audio", async () => {
    const quiet = vi.spyOn(console, "error").mockImplementation(() => {});
    const speak = vi.fn<Speak>(async () => {
      throw new Error("HTTP 500");
    });
    const all = await collect(speakReply(upstream(TWO_CHUNKS), { voice: VOICE, speak, ledger: new CostLedger(), listening: () => true }));
    expect(all.filter((e) => e.type === "audio_error")).toHaveLength(1);
    expect(all.some((e) => e.type === "audio")).toBe(false);
    expect(all.filter((e) => e.type !== "audio_error")).toEqual(TWO_CHUNKS);
    expect(quiet).toHaveBeenCalled();
  });

  // Review Focus 1: the persona's voice was deleted mid-visit.
  it("with no voice, streams the text and one audio_error after done", async () => {
    const speak = vi.fn<Speak>();
    const all = await collect(speakReply(upstream(TWO_CHUNKS), { voice: null, speak, ledger: new CostLedger(), listening: () => true }));
    expect(all).toEqual([...TWO_CHUNKS, { type: "audio_error" }]);
    expect(speak).not.toHaveBeenCalled();
  });

  // Review Focus 4: the browser went away.
  it("starts no new call once the browser stops listening", async () => {
    let listening = true;
    const speak = vi.fn<Speak>(async () => {
      listening = false;
      return { pcm: PCM, call: ttsCall };
    });
    const ledger = new CostLedger();
    const all = await collect(speakReply(upstream(TWO_CHUNKS), { voice: VOICE, speak, ledger, listening: () => listening }));
    expect(speak).toHaveBeenCalledTimes(1);
    expect(ledger.calls).toEqual([ttsCall]);
    expect(all.filter((e) => e.type !== "audio")).toEqual(TWO_CHUNKS);
  });
});
