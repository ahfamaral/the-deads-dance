import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createRecognition, createSpeechTurn, type RecognitionLike } from "@/lib/speech-input";

/**
 * A stand-in for the browser's SpeechRecognition: the test fires its events by hand. By default it
 * starts at once; `autoStart: false` holds `onstart` back, as a permission prompt does. By default
 * `stop()` ends it at once; `endOnStop: false` leaves the end to the test, as Chrome does while it
 * still processes the last words.
 */
function fakeRecognition({ autoStart = true, endOnStop = true } = {}) {
  const phrases: string[] = [];
  const rec: RecognitionLike & { started: boolean; stopped: number; say(text: string): void; fail(error: string): void } = {
    lang: "",
    continuous: false,
    interimResults: false,
    onresult: null,
    onerror: null,
    onend: null,
    onstart: null,
    started: false,
    stopped: 0,
    start() {
      this.started = true;
      if (autoStart) this.onstart?.();
    },
    stop() {
      this.stopped += 1;
      if (endOnStop) this.onend?.();
    },
    abort() {
      this.stopped += 1;
    },
    say(text: string) {
      phrases.push(text);
      const results = phrases.map((t) => Object.assign([{ transcript: t }], { isFinal: true }));
      this.onresult?.({ resultIndex: phrases.length - 1, results });
    },
    fail(error: string) {
      this.onerror?.({ error });
    },
  };
  return rec;
}

describe("createSpeechTurn (spec §33.4)", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it("starts a continuous recognition with interim results", () => {
    const rec = fakeRecognition();
    createSpeechTurn({ recognition: rec });
    expect(rec.started).toBe(true);
    expect(rec.continuous).toBe(true);
    expect(rec.interimResults).toBe(true);
  });

  it("ends after 3 s of silence following a result, and stops the recognition", async () => {
    const rec = fakeRecognition();
    const turn = createSpeechTurn({ recognition: rec });
    let settled: unknown = null;
    void turn.done.then((r) => (settled = r));
    vi.advanceTimersByTime(1000);
    rec.say("Guten Tag");
    vi.advanceTimersByTime(2999);
    await Promise.resolve();
    expect(settled).toBeNull();
    vi.advanceTimersByTime(1);
    await expect(turn.done).resolves.toEqual({ text: "Guten Tag" });
    expect(rec.stopped).toBeGreaterThan(0);
  });

  it("ends at 10 s even while results keep arriving every second", async () => {
    const rec = fakeRecognition();
    const turn = createSpeechTurn({ recognition: rec });
    let settled: unknown = null;
    void turn.done.then((r) => (settled = r));
    for (let i = 1; i <= 9; i++) {
      vi.advanceTimersByTime(1000);
      rec.say(`word${i}`);
    }
    await Promise.resolve();
    expect(settled).toBeNull();
    expect(turn.elapsed()).toBe(9000);
    vi.advanceTimersByTime(1000);
    await expect(turn.done).resolves.toEqual({ text: "word1 word2 word3 word4 word5 word6 word7 word8 word9" });
    expect(rec.stopped).toBeGreaterThan(0);
  });

  it("waits past 3 s for the first word: Chrome returns it ~1.5 s after speech starts", async () => {
    const rec = fakeRecognition();
    const turn = createSpeechTurn({ recognition: rec });
    let settled: unknown = null;
    void turn.done.then((r) => (settled = r));
    vi.advanceTimersByTime(3500);
    await Promise.resolve();
    expect(settled).toBeNull();
    rec.say("Hallo");
    vi.advanceTimersByTime(2999);
    await Promise.resolve();
    expect(settled).toBeNull();
    vi.advanceTimersByTime(1);
    await expect(turn.done).resolves.toEqual({ text: "Hallo" });
  });

  it("gives an empty transcript after 8 s with no speech at all", async () => {
    const rec = fakeRecognition();
    const turn = createSpeechTurn({ recognition: rec });
    let settled: unknown = null;
    void turn.done.then((r) => (settled = r));
    vi.advanceTimersByTime(7999);
    await Promise.resolve();
    expect(settled).toBeNull();
    vi.advanceTimersByTime(1);
    await expect(turn.done).resolves.toEqual({ text: "" });
    expect(rec.stopped).toBeGreaterThan(0);
  });

  it("reports a refused microphone as denied", async () => {
    const rec = fakeRecognition();
    const turn = createSpeechTurn({ recognition: rec });
    rec.fail("not-allowed");
    await expect(turn.done).resolves.toEqual({ error: "denied" });
  });

  it("reports other recognition errors as failed, and no-speech as an empty transcript", async () => {
    const rec = fakeRecognition();
    const turn = createSpeechTurn({ recognition: rec });
    rec.fail("network");
    await expect(turn.done).resolves.toEqual({ error: "failed" });
    const quiet = fakeRecognition();
    const quietTurn = createSpeechTurn({ recognition: quiet });
    quiet.fail("no-speech");
    await expect(quietTurn.done).resolves.toEqual({ text: "" });
  });

  it("a tap sends the transcript so far", async () => {
    const rec = fakeRecognition();
    const turn = createSpeechTurn({ recognition: rec });
    rec.say("  Wie geht ");
    rec.say(" es Ihnen?");
    turn.stop();
    await expect(turn.done).resolves.toEqual({ text: "Wie geht es Ihnen?" });
    expect(rec.stopped).toBe(1);
  });

  it("a tap waits for the words Chrome is still processing, until it ends", async () => {
    const rec = fakeRecognition({ endOnStop: false });
    const turn = createSpeechTurn({ recognition: rec });
    let settled: unknown = null;
    void turn.done.then((r) => (settled = r));
    rec.say("Wie geht");
    turn.stop();
    expect(rec.stopped).toBe(1);
    rec.say("es Ihnen?");
    await Promise.resolve();
    expect(settled).toBeNull();
    rec.onend?.();
    await expect(turn.done).resolves.toEqual({ text: "Wie geht es Ihnen?" });
  });

  it("a tap sends what was heard after 2 s when the browser never ends", async () => {
    const rec = fakeRecognition({ endOnStop: false });
    const turn = createSpeechTurn({ recognition: rec });
    let settled: unknown = null;
    void turn.done.then((r) => (settled = r));
    rec.say("Ja");
    turn.stop();
    vi.advanceTimersByTime(1999);
    await Promise.resolve();
    expect(settled).toBeNull();
    vi.advanceTimersByTime(1);
    await expect(turn.done).resolves.toEqual({ text: "Ja" });
  });

  it("the 10 s cap also waits for the last words", async () => {
    const rec = fakeRecognition({ endOnStop: false });
    const turn = createSpeechTurn({ recognition: rec });
    for (let i = 1; i <= 9; i++) {
      vi.advanceTimersByTime(1000);
      rec.say(`w${i}`);
    }
    vi.advanceTimersByTime(1000);
    expect(rec.stopped).toBe(1);
    expect(turn.elapsed()).toBe(10_000);
    rec.say("w10");
    rec.onend?.();
    await expect(turn.done).resolves.toEqual({ text: "w1 w2 w3 w4 w5 w6 w7 w8 w9 w10" });
  });

  it("settles once: events after the end are ignored", async () => {
    const rec = fakeRecognition();
    const turn = createSpeechTurn({ recognition: rec });
    rec.say("Ja");
    turn.stop();
    rec.fail("aborted");
    rec.onend?.();
    vi.advanceTimersByTime(20_000);
    await expect(turn.done).resolves.toEqual({ text: "Ja" });
  });

  it("doesn't time out while the recognition hasn't started (the permission prompt is up)", async () => {
    const rec = fakeRecognition({ autoStart: false });
    const turn = createSpeechTurn({ recognition: rec });
    let settled: unknown = null;
    void turn.done.then((r) => (settled = r));
    vi.advanceTimersByTime(12_000);
    await Promise.resolve();
    expect(settled).toBeNull();
    expect(turn.elapsed()).toBe(0);
    rec.onstart?.();
    vi.advanceTimersByTime(1000);
    expect(turn.elapsed()).toBe(1000);
    rec.say("Hallo");
    vi.advanceTimersByTime(2999);
    await Promise.resolve();
    expect(settled).toBeNull();
    vi.advanceTimersByTime(1);
    await expect(turn.done).resolves.toEqual({ text: "Hallo" });
  });

  it("the 10 s cap counts from the start, not from the tap", async () => {
    const rec = fakeRecognition({ autoStart: false });
    const turn = createSpeechTurn({ recognition: rec });
    let settled: unknown = null;
    void turn.done.then((r) => (settled = r));
    vi.advanceTimersByTime(5000);
    rec.onstart?.();
    for (let i = 1; i <= 9; i++) {
      vi.advanceTimersByTime(1000);
      rec.say(`w${i}`);
    }
    await Promise.resolve();
    expect(settled).toBeNull();
    vi.advanceTimersByTime(1000);
    await expect(turn.done).resolves.toEqual({ text: "w1 w2 w3 w4 w5 w6 w7 w8 w9" });
  });

  it("fails when the recognition never starts within 15 s", async () => {
    const rec = fakeRecognition({ autoStart: false });
    const turn = createSpeechTurn({ recognition: rec });
    vi.advanceTimersByTime(15_000);
    await expect(turn.done).resolves.toEqual({ error: "failed" });
    expect(rec.stopped).toBeGreaterThan(0);
  });

  it("the browser ending the session on its own sends what was heard", async () => {
    const rec = fakeRecognition();
    const turn = createSpeechTurn({ recognition: rec });
    rec.say("Danke");
    rec.onend?.();
    await expect(turn.done).resolves.toEqual({ text: "Danke" });
  });
});

describe("createRecognition", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("listens in the language's speech locale (pt → pt-BR), else the bare code", () => {
    class FakeRecognition {
      lang = "";
    }
    vi.stubGlobal("window", { SpeechRecognition: FakeRecognition });
    expect(createRecognition("pt")?.lang).toBe("pt-BR");
    expect(createRecognition("de")?.lang).toBe("de-DE");
    expect(createRecognition("xx")?.lang).toBe("xx");
  });

  it("is null without speech recognition", () => {
    vi.stubGlobal("window", {});
    expect(createRecognition("pt")).toBeNull();
  });
});
