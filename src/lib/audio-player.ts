let context: AudioContext | null = null;

/**
 * Spec §33.4: one AudioContext per tab, created on first use. The Start tap calls this and resumes
 * it inside the gesture, which unlocks playback on iOS. Null on the server or without Web Audio.
 */
export function getAudioContext(): AudioContext | null {
  if (typeof window === "undefined") return null;
  if (!context) {
    const Ctor = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!Ctor) return null;
    context = new Ctor();
  }
  return context;
}

/** Spec §33.5: Gemini's PCM (16-bit little-endian mono), base64, as Web Audio samples in -1..1. */
export function pcm16ToFloat32(base64: string): Float32Array {
  const binary = atob(base64);
  const samples = new Float32Array(binary.length >> 1);
  for (let i = 0; i < samples.length; i++) {
    const value = binary.charCodeAt(2 * i) | (binary.charCodeAt(2 * i + 1) << 8);
    samples[i] = (value >= 0x8000 ? value - 0x10000 : value) / 0x8000;
  }
  return samples;
}

export type PcmPlayer = {
  enqueue(data: string, sampleRate: number): void;
  /** The loudness now, 0..1 (RMS from an AnalyserNode); drives the speaking ring. */
  level(): number;
  /** Called each time the last scheduled buffer has finished playing. */
  onIdle(cb: () => void): void;
  /** Called when the scheduled audio stopped moving for 2 s (the player has stopped itself). */
  onStall(cb: () => void): void;
  /** Resumes the context, e.g. when the tab is visible again, and gives it 2 s more. */
  resume(): void;
  stop(): void;
  /** Stops and disconnects the analyser; the player is not used again. */
  dispose(): void;
  playing(): boolean;
};

/** Speech RMS rarely passes ~0.3, so it is scaled up to fill the ring's range. */
const LEVEL_GAIN = 3;
const WATCHDOG_TICK_MS = 500;
/** A context that isn't running (an iOS tab in the background, an interruption) never ends its buffers. */
const STALL_MS = 2_000;

/** Spec §33.4: plays the answer's audio chunks back to back through one context and analyser. */
export function createPcmPlayer(ctx: AudioContext): PcmPlayer {
  const analyser = ctx.createAnalyser();
  analyser.fftSize = 512;
  analyser.connect(ctx.destination);
  const frame = new Float32Array(analyser.fftSize);
  const sources = new Set<AudioBufferSourceNode>();
  const idle: (() => void)[] = [];
  const stalled: (() => void)[] = [];
  let endOfLast = 0;
  // Counted in ticks, so time the tab spent frozen doesn't count towards a stall.
  let watchdog: ReturnType<typeof setInterval> | null = null;
  let lastTime = 0;
  let stillFor = 0;

  const resumeContext = () => {
    if (ctx.state !== "running") void ctx.resume().catch(() => {});
  };

  const stopWatchdog = () => {
    if (watchdog !== null) clearInterval(watchdog);
    watchdog = null;
  };

  const startWatchdog = () => {
    lastTime = ctx.currentTime;
    stillFor = 0;
    if (watchdog !== null) return;
    watchdog = setInterval(() => {
      // A hidden tab may have its context interrupted (iOS); the tab's visibility handler resumes it on return.
      if (typeof document !== "undefined" && document.visibilityState === "hidden") {
        lastTime = ctx.currentTime;
        stillFor = 0;
        return;
      }
      if (ctx.currentTime !== lastTime) {
        lastTime = ctx.currentTime;
        stillFor = 0;
        return;
      }
      stillFor += WATCHDOG_TICK_MS;
      if (stillFor < STALL_MS) return;
      stop();
      for (const cb of stalled) cb();
    }, WATCHDOG_TICK_MS);
  };

  const stop = () => {
    stopWatchdog();
    for (const source of sources) {
      source.onended = null;
      try {
        source.stop();
      } catch {
        // Not started yet, or already ended.
      }
      source.disconnect();
    }
    sources.clear();
    endOfLast = 0;
  };

  return {
    enqueue(data, sampleRate) {
      const samples = pcm16ToFloat32(data);
      if (samples.length === 0) return;
      resumeContext();
      const buffer = ctx.createBuffer(1, samples.length, sampleRate);
      buffer.getChannelData(0).set(samples);
      const source = ctx.createBufferSource();
      source.buffer = buffer;
      source.connect(analyser);
      const at = Math.max(ctx.currentTime, endOfLast);
      source.start(at);
      endOfLast = at + buffer.duration;
      if (sources.size === 0) startWatchdog();
      sources.add(source);
      source.onended = () => {
        sources.delete(source);
        source.disconnect();
        if (sources.size > 0) return;
        stopWatchdog();
        for (const cb of idle) cb();
      };
    },
    level() {
      if (sources.size === 0) return 0;
      analyser.getFloatTimeDomainData(frame);
      let sum = 0;
      for (const v of frame) sum += v * v;
      return Math.min(1, Math.sqrt(sum / frame.length) * LEVEL_GAIN);
    },
    onIdle(cb) {
      idle.push(cb);
    },
    onStall(cb) {
      stalled.push(cb);
    },
    resume() {
      resumeContext();
      if (sources.size > 0) startWatchdog();
    },
    stop,
    dispose() {
      stop();
      idle.length = 0;
      stalled.length = 0;
      analyser.disconnect();
    },
    playing: () => sources.size > 0,
  };
}
