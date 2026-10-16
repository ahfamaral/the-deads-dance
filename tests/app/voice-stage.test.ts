import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import VoiceStage from "@/components/voice-stage";
import { voiceStageState, type VoiceStageInput } from "@/lib/voice-stage-state";

const base: VoiceStageInput = {
  personaName: "Albert Einstein",
  thinkingLine: "Albert Einstein is remembering…",
  resumeNeeded: false,
  listening: false,
  turnRunning: false,
  playing: false,
  ended: false,
  turnError: null,
  lostText: null,
  outOfEnergy: false,
};
const state = (patch: Partial<VoiceStageInput>) => voiceStageState({ ...base, ...patch });

describe("voiceStageState (spec §33.4 table, §33.5 errors)", () => {
  it("your turn: Tap and speak, mic", () => {
    expect(state({})).toEqual({ kind: "idle", line: "Tap and speak", button: "mic" });
  });

  it("listening: Listening…, stop", () => {
    expect(state({ listening: true })).toEqual({ kind: "listening", line: "Listening…", button: "stop" });
  });

  it("thinking: today's thinking line, mic greyed", () => {
    expect(state({ turnRunning: true })).toEqual({ kind: "thinking", line: "Albert Einstein is remembering…", button: "disabled" });
    expect(state({ turnRunning: true, thinkingLine: null }).line).toBe("Albert Einstein is thinking…");
  });

  it("speaking: Speaking…, mic greyed, also while the turn still runs", () => {
    expect(state({ playing: true })).toEqual({ kind: "speaking", line: "Speaking…", button: "disabled" });
    expect(state({ playing: true, turnRunning: true }).kind).toBe("speaking");
  });

  it("ended: the persona has ended the visit, no button; the goodbye is still spoken first", () => {
    expect(state({ ended: true })).toEqual({ kind: "ended", line: "Albert Einstein has ended the visit.", button: "hidden" });
    expect(state({ ended: true, playing: true }).kind).toBe("speaking");
  });

  it("a retryable error shows its reason and Retry; another error leaves the mic", () => {
    expect(state({ turnError: { reason: "The reply was interrupted.", retryable: true } })).toEqual({
      kind: "error",
      line: "The reply was interrupted.",
      button: "retry",
    });
    expect(state({ turnError: { reason: "Allow the microphone for this site to talk.", retryable: false } })).toEqual({
      kind: "error",
      line: "Allow the microphone for this site to talk.",
      button: "mic",
    });
  });

  it("a lost voice: the note, then the mic", () => {
    expect(state({ lostText: "Ja, das stimmt." })).toEqual({
      kind: "lost",
      line: "Albert Einstein's voice was lost for this answer.",
      button: "mic",
    });
  });

  it("a restored conversation waits for a tap", () => {
    expect(state({ resumeNeeded: true })).toEqual({ kind: "resume", line: "Tap to continue", button: "mic" });
  });

  it("out of energy disables the mic", () => {
    expect(state({ outOfEnergy: true }).button).toBe("disabled");
    expect(state({ outOfEnergy: true, lostText: "x" }).button).toBe("disabled");
  });
});

const noop = () => {};
const html = (patch: Partial<VoiceStageInput> = {}, lostText: string | null = null) =>
  renderToStaticMarkup(
    createElement(VoiceStage, {
      personaName: "Albert Einstein",
      voiceLanguageName: "German",
      state: state({ ...patch, lostText }),
      lostText,
      level: () => 0,
      listen: { elapsed: () => 0, micLevel: () => 0 },
      onMic: noop,
      onStop: noop,
      onRetry: noop,
      onResume: noop,
    }),
  );

describe("VoiceStage", () => {
  it("shows the orb label and a 68 px mic button, and no message text", () => {
    const h = html();
    expect(h).toContain("An imagined voice · German");
    expect(h).toContain("Tap and speak");
    expect(h).toContain("Tap to talk");
    expect(h).toMatch(/<button[^>]*size-\[68px\]/);
    expect(h).not.toContain("<ol");
  });

  it("shows the answer's text only when its voice was lost", () => {
    expect(html({}, "Ja, das stimmt.")).toContain("Ja, das stimmt.");
    expect(html({}, "Ja, das stimmt.")).toContain("Albert Einstein&#x27;s voice was lost for this answer.");
  });

  it("listening shows the stop button, the 10 s ring and the send hint", () => {
    const h = html({ listening: true });
    expect(h).toContain("Listening…");
    expect(h).toContain("Tap to send");
    expect(h).toContain('aria-label="Stop and send"');
    expect(h).toContain("stroke-dasharray");
  });

  it("thinking greys the mic and asks to wait", () => {
    const h = html({ turnRunning: true });
    expect(h).toContain("Wait for the answer");
    expect(h).toMatch(/<button[^>]*disabled/);
  });

  it("a retryable error offers Retry in the mic's place", () => {
    expect(html({ turnError: { reason: "The reply was interrupted.", retryable: true } })).toMatch(/<button[^>]*>Retry</);
  });

  it("ended hides the button", () => {
    const h = html({ ended: true });
    expect(h).toContain("Albert Einstein has ended the visit.");
    expect(h).not.toContain("<button");
  });
});
