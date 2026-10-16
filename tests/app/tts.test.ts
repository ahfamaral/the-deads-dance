import { describe, expect, it, vi } from "vitest";
import { PCM_SAMPLE_RATE, TTS_MODEL, pcmToWav, speakWith } from "@/lib/server/tts";

const req = { text: "Hello.", voice: "Algenib", instructions: "Calm." };
const bad = () => new Response("boom", { status: 500 });

describe("speakWith", () => {
  it("posts a PCM speech request and estimates tokens", async () => {
    const pcm = Buffer.alloc(48000); // one second
    const fetchImpl = vi.fn(async (_url: string | URL | Request, _init?: RequestInit) => new Response(pcm, { headers: { "x-generation-id": "gen-1" } }));
    const out = await speakWith(fetchImpl, () => "k")(req);
    const [url, init] = fetchImpl.mock.calls[0];
    expect(url).toMatch(/\/audio\/speech$/);
    expect((init!.headers as Record<string, string>).Authorization).toBe("Bearer k");
    expect(JSON.parse(init!.body as string)).toEqual({ model: TTS_MODEL, input: "Hello.", voice: "Algenib", instructions: "Calm.", response_format: "pcm" });
    expect(out.pcm.length).toBe(48000);
    expect(out.call).toMatchObject({ role: "tts", model: TTS_MODEL, outputTokens: 32, inputTokens: Math.ceil("Calm.Hello.".length / 4), cost: null, generationId: "gen-1" });
    expect(out.call.latencyMs).toBeGreaterThanOrEqual(0);
  });

  it("has no generation id when the header is absent", async () => {
    const out = await speakWith(vi.fn(async () => new Response(Buffer.alloc(10))), () => "k")(req);
    expect(out.call.generationId).toBeNull();
  });

  it("retries once, then throws", async () => {
    const fetchImpl = vi.fn(async () => bad());
    await expect(speakWith(fetchImpl, () => "k")(req)).rejects.toThrow(/500/);
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });

  it("succeeds on the retry", async () => {
    const fetchImpl = vi.fn().mockResolvedValueOnce(bad()).mockResolvedValueOnce(new Response(Buffer.alloc(10)));
    await expect(speakWith(fetchImpl, () => "k")(req)).resolves.toMatchObject({ call: { role: "tts" } });
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });

  it("retries after a network error", async () => {
    const fetchImpl = vi.fn().mockRejectedValueOnce(new TypeError("fetch failed")).mockResolvedValueOnce(new Response(Buffer.alloc(10)));
    await speakWith(fetchImpl, () => "k")(req);
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });

  it("does not retry when the caller aborted", async () => {
    const ctrl = new AbortController();
    const fetchImpl = vi.fn(async () => {
      ctrl.abort();
      throw new DOMException("aborted", "AbortError");
    });
    await expect(speakWith(fetchImpl, () => "k")({ ...req, signal: ctrl.signal })).rejects.toThrow();
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it("fails without a key, without calling out", async () => {
    const fetchImpl = vi.fn();
    await expect(speakWith(fetchImpl, () => undefined)(req)).rejects.toThrow(/OPENROUTER_API_KEY/);
    expect(fetchImpl).not.toHaveBeenCalled();
  });
});

describe("pcmToWav", () => {
  it("wraps PCM in a WAV header", () => {
    const wav = pcmToWav(Buffer.alloc(10));
    expect(wav.subarray(0, 4).toString()).toBe("RIFF");
    expect(wav.subarray(8, 12).toString()).toBe("WAVE");
    expect(wav.length).toBe(54);
    expect(wav.readUInt32LE(24)).toBe(PCM_SAMPLE_RATE);
    expect(wav.readUInt32LE(40)).toBe(10);
  });
});
