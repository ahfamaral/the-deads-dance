"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { createPcmPlayer, getAudioContext, type PcmPlayer } from "@/lib/audio-player";
import { createRecognition, createSpeechTurn, type SpeechResult } from "@/lib/speech-input";

/** Spec §33.4: the microphone errors, verbatim. */
export const MIC_DENIED = "Allow the microphone for this site to talk.";
export const MIC_FAILED = "I couldn't hear that. Tap and try again.";

/** What a finished speech turn leads to: a transcript to send, or a message (nothing heard counts as not heard). */
export function turnOutcome(result: SpeechResult): { text: string } | { error: string } {
  if ("error" in result) return { error: result.error === "denied" ? MIC_DENIED : MIC_FAILED };
  return result.text ? result : { error: MIC_FAILED };
}

/**
 * Spec §33.4: whether the bars may open their own mic stream next to recognition. Desktop Chrome shares
 * the mic; Android Chrome lets the stream take it, so recognition hears nothing (2026-10-17), and iOS
 * is said to do the same. iPadOS reports a Mac, so touch points tell it apart.
 */
export function micSharedWithRecognition(userAgent: string, maxTouchPoints: number): boolean {
  if (/Android|iPhone|iPad|iPod/i.test(userAgent)) return false;
  return !(/Macintosh/.test(userAgent) && maxTouchPoints > 1);
}

const MIC_GAIN = 4;
/** How long the fallback bars take to settle after a recognition result. */
const RESULT_PULSE_MS = 400;

type Listening = {
  turn: ReturnType<typeof createSpeechTurn>;
  stream: MediaStream | null;
  source: MediaStreamAudioSourceNode | null;
  analyser: AnalyserNode | null;
  lastResult: number;
};

/**
 * Spec §33.4: the voice screen's microphone and speaker. Listening runs one speech turn and hands a
 * non-empty transcript to its `onTranscript`; the mic's level comes from a getUserMedia analyser, or
 * pulses on recognition results on phones (see micSharedWithRecognition) or when the stream can't open. Audio chunks play back to back. All of
 * it stops when the screen goes away, and the mic stream is released as soon as listening ends.
 * Audio that stops moving (a suspended context) is stopped and reported to `onStall`, so the answer
 * can show as a lost voice instead of "Speaking…" forever; the tab coming back tries to resume first.
 */
export function useVoiceControls(language: string, onStall?: () => void) {
  const [listening, setListening] = useState(false);
  const [speechError, setSpeechError] = useState<string | null>(null);
  const [playing, setPlaying] = useState(false);
  const current = useRef<Listening | null>(null);
  const player = useRef<PcmPlayer | null>(null);
  const stallHandler = useRef(onStall);
  useEffect(() => {
    stallHandler.current = onStall;
  });

  const release = (l: Listening) => {
    for (const track of l.stream?.getTracks() ?? []) track.stop();
    l.source?.disconnect();
    l.analyser?.disconnect();
  };

  useEffect(
    () => () => {
      const l = current.current;
      current.current = null; // its result is dropped, never sent
      if (l) {
        l.turn.stop();
        release(l);
      }
      player.current?.dispose();
    },
    [],
  );

  useEffect(() => {
    const onVisible = () => {
      if (document.visibilityState === "visible" && player.current?.playing()) player.current.resume();
    };
    document.addEventListener("visibilitychange", onVisible);
    return () => document.removeEventListener("visibilitychange", onVisible);
  }, []);

  function startListening(onTranscript: (text: string) => void) {
    if (current.current) return;
    setSpeechError(null);
    const ctx = getAudioContext();
    // Inside the tap, so iOS lets the answer play.
    void ctx?.resume().catch(() => {});
    const recognition = createRecognition(language);
    if (!recognition) {
      setSpeechError(MIC_FAILED);
      return;
    }
    const l: Listening = {
      turn: createSpeechTurn({ recognition, onResult: () => (l.lastResult = performance.now()) }),
      stream: null,
      source: null,
      analyser: null,
      lastResult: -Infinity,
    };
    current.current = l;
    setListening(true);

    if (micSharedWithRecognition(navigator.userAgent, navigator.maxTouchPoints ?? 0))
      void navigator.mediaDevices
        ?.getUserMedia({ audio: true })
        .then((stream) => {
          if (current.current !== l || !ctx) {
            for (const track of stream.getTracks()) track.stop();
            return;
          }
          l.stream = stream;
          const analyser = ctx.createAnalyser();
          analyser.fftSize = 256;
          l.source = ctx.createMediaStreamSource(stream);
          l.source.connect(analyser);
          l.analyser = analyser;
        })
        .catch(() => {}); // the bars fall back to recognition results, as on phones

    void l.turn.done.then((result) => {
      if (current.current !== l) return;
      current.current = null;
      release(l);
      setListening(false);
      const outcome = turnOutcome(result);
      if ("error" in outcome) setSpeechError(outcome.error);
      else onTranscript(outcome.text);
    });
  }

  // Stable, so the animations that poll them don't restart on every render.
  const micLevel = useCallback((): number => {
    const l = current.current;
    if (!l) return 0;
    if (l.analyser) {
      const frame = new Float32Array(l.analyser.fftSize);
      l.analyser.getFloatTimeDomainData(frame);
      let sum = 0;
      for (const v of frame) sum += v * v;
      return Math.min(1, Math.sqrt(sum / frame.length) * MIC_GAIN);
    }
    return Math.max(0, 1 - (performance.now() - l.lastResult) / RESULT_PULSE_MS);
  }, []);
  const elapsed = useCallback(() => current.current?.turn.elapsed() ?? 0, []);
  const level = useCallback(() => player.current?.level() ?? 0, []);

  function enqueue(data: string, sampleRate: number) {
    if (!player.current) {
      const ctx = getAudioContext();
      if (!ctx) return;
      player.current = createPcmPlayer(ctx);
      player.current.onIdle(() => setPlaying(false));
      player.current.onStall(() => {
        setPlaying(false);
        stallHandler.current?.();
      });
    }
    player.current.enqueue(data, sampleRate);
    setPlaying(true);
  }

  return {
    listening,
    speechError,
    playing,
    startListening,
    /** A tap while listening: send what was heard. */
    stopListening: () => current.current?.turn.stop(),
    elapsed,
    micLevel,
    enqueue,
    level,
  };
}
