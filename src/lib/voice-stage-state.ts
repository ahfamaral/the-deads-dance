export type VoiceStageInput = {
  personaName: string;
  /** Today's thinking line (thinking.ts); null falls back to "{name} is thinking…". */
  thinkingLine: string | null;
  /** Spec §33.5: a restored voice conversation waits for a tap, which unlocks audio on iOS. */
  resumeNeeded: boolean;
  listening: boolean;
  /** A turn is streaming, or the server is still writing one (spec §26.4). */
  turnRunning: boolean;
  /** The answer's audio has started and not finished. */
  playing: boolean;
  ended: boolean;
  /** The turn's error, or the microphone's (spec §33.4), shown as the state line. */
  turnError: { reason: string; retryable: boolean } | null;
  /** Spec §33.5: the text of the answer whose voice was lost. */
  lostText: string | null;
  outOfEnergy: boolean;
};

export type VoiceStageKind = "resume" | "idle" | "listening" | "thinking" | "speaking" | "ended" | "error" | "lost";

export type VoiceStageView = {
  kind: VoiceStageKind;
  line: string;
  button: "mic" | "stop" | "retry" | "disabled" | "hidden";
};

/**
 * Spec §33.4's table of voice screen states, with §33.5's errors, lost voice and "Tap to continue".
 * The goodbye is spoken before the visit shows as ended; out of energy greys the mic as the text
 * input is disabled today.
 */
export function voiceStageState(s: VoiceStageInput): VoiceStageView {
  const mic = s.outOfEnergy ? "disabled" : "mic";
  if (s.resumeNeeded) return { kind: "resume", line: "Tap to continue", button: "mic" };
  if (s.listening) return { kind: "listening", line: "Listening…", button: "stop" };
  if (s.playing) return { kind: "speaking", line: "Speaking…", button: "disabled" };
  if (s.turnRunning) return { kind: "thinking", line: s.thinkingLine ?? `${s.personaName} is thinking…`, button: "disabled" };
  if (s.ended) return { kind: "ended", line: `${s.personaName} has ended the visit.`, button: "hidden" };
  if (s.turnError) return { kind: "error", line: s.turnError.reason, button: s.turnError.retryable ? "retry" : mic };
  if (s.lostText !== null) return { kind: "lost", line: `${s.personaName}'s voice was lost for this answer.`, button: mic };
  return { kind: "idle", line: "Tap and speak", button: mic };
}
