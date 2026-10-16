import { describe, expect, it } from "vitest";
import { createPcmPlayer, pcm16ToFloat32 } from "@/lib/audio-player";

describe("pcm16ToFloat32 (spec §33.5: 16-bit little-endian mono)", () => {
  it("decodes base64 samples to -1..1", () => {
    const base64 = Buffer.from([0x00, 0x80, 0xff, 0x7f]).toString("base64");
    const samples = pcm16ToFloat32(base64);
    expect(samples).toHaveLength(2);
    expect(samples[0]).toBe(-1);
    expect(samples[1]).toBeCloseTo(0.99997, 5);
  });

  it("drops a trailing odd byte", () => {
    expect(pcm16ToFloat32(Buffer.from([0, 0, 1]).toString("base64"))).toHaveLength(1);
  });
});

/** Just enough of an AudioContext to see when each buffer is scheduled. */
function fakeContext(currentTime = 0) {
  const starts: number[] = [];
  const sources: { onended: (() => void) | null }[] = [];
  const analyser = { fftSize: 0, disconnected: false, connect() {}, disconnect() { this.disconnected = true; }, getFloatTimeDomainData(a: Float32Array) { a.fill(0.5); } };
  const ctx = {
    currentTime,
    destination: {},
    createAnalyser: () => analyser,
    createBuffer: (_channels: number, length: number, rate: number) => ({ duration: length / rate, getChannelData: () => new Float32Array(length) }),
    createBufferSource: () => {
      const source = { buffer: null, onended: null as (() => void) | null, connect() {}, disconnect() {}, start: (at: number) => starts.push(at), stop() {} };
      sources.push(source);
      return source;
    },
  };
  return { ctx: ctx as unknown as AudioContext, starts, sources, analyser, setTime: (t: number) => (ctx.currentTime = t) };
}

const second = (rate: number) => Buffer.alloc(rate * 2).toString("base64");

describe("createPcmPlayer (spec §33.4: chunks play back to back)", () => {
  it("schedules each buffer at the end of the last one", () => {
    const { ctx, starts } = fakeContext(1);
    const player = createPcmPlayer(ctx);
    player.enqueue(second(24000), 24000);
    player.enqueue(second(12000), 24000); // half a second
    player.enqueue(second(24000), 24000);
    expect(starts).toEqual([1, 2, 2.5]);
    expect(player.playing()).toBe(true);
  });

  it("starts at the current time after a gap", () => {
    const { ctx, starts, setTime } = fakeContext(0);
    const player = createPcmPlayer(ctx);
    player.enqueue(second(24000), 24000);
    setTime(5);
    player.enqueue(second(24000), 24000);
    expect(starts).toEqual([0, 5]);
  });

  it("calls onIdle when the last buffer has played, and not after stop()", () => {
    const { ctx, sources } = fakeContext(0);
    const player = createPcmPlayer(ctx);
    let idle = 0;
    player.onIdle(() => (idle += 1));
    player.enqueue(second(24000), 24000);
    player.enqueue(second(24000), 24000);
    sources[0].onended?.();
    expect(idle).toBe(0);
    sources[1].onended?.();
    expect(idle).toBe(1);
    expect(player.playing()).toBe(false);
    player.enqueue(second(24000), 24000);
    player.stop();
    expect(player.playing()).toBe(false);
    expect(idle).toBe(1);
  });

  it("reads the loudness as 0..1 while playing, 0 when idle", () => {
    const { ctx } = fakeContext(0);
    const player = createPcmPlayer(ctx);
    expect(player.level()).toBe(0);
    player.enqueue(second(24000), 24000);
    expect(player.level()).toBeGreaterThan(0);
    expect(player.level()).toBeLessThanOrEqual(1);
  });

  it("dispose() stops playback and disconnects its analyser", () => {
    const { ctx, analyser } = fakeContext(0);
    const player = createPcmPlayer(ctx);
    player.enqueue(second(24000), 24000);
    player.dispose();
    expect(player.playing()).toBe(false);
    expect(analyser.disconnected).toBe(true);
  });
});
