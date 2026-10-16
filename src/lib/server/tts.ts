import { OPENROUTER_BASE_URL } from "@corpus/embeddings";
import { estimateTokens, type ModelCallRecord } from "@corpus/cost-ledger";

export const TTS_MODEL = "google/gemini-3.8-flash-tts";
/** Gemini speech comes back as raw PCM: 24 kHz, 16-bit little-endian, mono. */
export const PCM_SAMPLE_RATE = 24_000;
const TTS_TIMEOUT_MS = 20_000;
const BYTES_PER_SECOND = PCM_SAMPLE_RATE * 2;
const TOKENS_PER_SECOND = 32;

export type Speak = (r: {
  text: string;
  voice: string;
  instructions: string;
  signal?: AbortSignal;
}) => Promise<{ pcm: Buffer; call: ModelCallRecord }>;

/** Spec §33.5: POST /audio/speech with the app's key; 20 s per attempt, one retry on an HTTP error or network failure (never on the caller's abort). */
export function speakWith(
  fetchImpl: typeof fetch = fetch,
  apiKey: () => string | undefined = () => process.env.OPENROUTER_API_KEY,
): Speak {
  return async ({ text, voice, instructions, signal }) => {
    const key = apiKey();
    if (!key) throw new Error("OPENROUTER_API_KEY is not set.");
    const body = JSON.stringify({ model: TTS_MODEL, input: text, voice, instructions, response_format: "pcm" });
    const startedAt = Date.now();

    const attempt = async () => {
      const timeout = AbortSignal.timeout(TTS_TIMEOUT_MS);
      const res = await fetchImpl(`${OPENROUTER_BASE_URL}/audio/speech`, {
        method: "POST",
        headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
        body,
        signal: signal ? AbortSignal.any([signal, timeout]) : timeout,
      });
      if (!res.ok) throw new Error(`OpenRouter /audio/speech: HTTP ${res.status}`);
      return { pcm: Buffer.from(await res.arrayBuffer()), generationId: res.headers.get("x-generation-id") };
    };

    let result;
    try {
      result = await attempt();
    } catch (err) {
      if (signal?.aborted) throw err;
      result = await attempt();
    }

    return {
      pcm: result.pcm,
      call: {
        role: "tts",
        model: TTS_MODEL,
        inputTokens: estimateTokens(instructions + text),
        outputTokens: Math.round((result.pcm.length / BYTES_PER_SECOND) * TOKENS_PER_SECOND),
        cost: null,
        generationId: result.generationId,
        latencyMs: Date.now() - startedAt,
      },
    };
  };
}

export const speak = speakWith();

/** Wraps raw PCM (mono, 16-bit) in a 44-byte RIFF/WAVE header so a browser can decode it. */
export function pcmToWav(pcm: Buffer, sampleRate: number = PCM_SAMPLE_RATE): Buffer {
  const header = Buffer.alloc(44);
  header.write("RIFF", 0);
  header.writeUInt32LE(36 + pcm.length, 4);
  header.write("WAVE", 8);
  header.write("fmt ", 12);
  header.writeUInt32LE(16, 16);
  header.writeUInt16LE(1, 20); // PCM
  header.writeUInt16LE(1, 22); // mono
  header.writeUInt32LE(sampleRate, 24);
  header.writeUInt32LE(sampleRate * 2, 28);
  header.writeUInt16LE(2, 32);
  header.writeUInt16LE(16, 34);
  header.write("data", 36);
  header.writeUInt32LE(pcm.length, 40);
  return Buffer.concat([header, pcm]);
}
