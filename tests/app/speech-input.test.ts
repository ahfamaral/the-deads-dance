import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createSpeechTurn, type RecognitionLike } from "@/lib/speech-input";

/** A stand-in for the browser's SpeechRecognition: the test fires its events by hand. */
function fakeRecognition() {
  const phrases: string[] = [];
  const rec: RecognitionLike & { started: boolean; stopped: number; say(text: string): void; fail(error: string): void } = {
    lang: "",
    continuous: false,
    interimResults: false,
    onresult: null,
    onerror: null,
    onend: null,
    started: false,
    stopped: 0,
    start() {
      this.started = true;
    },
    stop() {
      this.stopped += 1;
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

  it("gives an empty transcript after 3 s with no speech at all", async () => {
    const rec = fakeRecognition();
    const turn = createSpeechTurn({ recognition: rec });
    vi.advanceTimersByTime(3000);
    await expect(turn.done).resolves.toEqual({ text: "" });
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

  it("the browser ending the session on its own sends what was heard", async () => {
    const rec = fakeRecognition();
    const turn = createSpeechTurn({ recognition: rec });
    rec.say("Danke");
    rec.onend?.();
    await expect(turn.done).resolves.toEqual({ text: "Danke" });
  });
});
