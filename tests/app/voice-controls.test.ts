import { describe, expect, it } from "vitest";
import { MIC_DENIED, MIC_FAILED, micSharedWithRecognition, turnOutcome } from "@/components/use-voice-controls";

describe("turnOutcome (spec §33.4)", () => {
  it("sends a transcript", () => {
    expect(turnOutcome({ text: "Guten Tag" })).toEqual({ text: "Guten Tag" });
  });

  it("nothing heard shows the couldn't-hear error instead of returning silently", () => {
    expect(turnOutcome({ text: "" })).toEqual({ error: MIC_FAILED });
  });

  it("maps a refused microphone and other failures to their messages", () => {
    expect(turnOutcome({ error: "denied" })).toEqual({ error: MIC_DENIED });
    expect(turnOutcome({ error: "failed" })).toEqual({ error: MIC_FAILED });
  });
});

describe("micSharedWithRecognition (spec §33.4)", () => {
  it("is false on phones and tablets, where the bars' stream starves recognition", () => {
    const android = "Mozilla/5.0 (Linux; Android 15; Pixel 9) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0 Mobile Safari/537.36";
    const iphone = "Mozilla/5.0 (iPhone; CPU iPhone OS 19_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/19.0 Mobile/15E148 Safari/604.1";
    const ipad = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/19.0 Safari/605.1.15";
    expect(micSharedWithRecognition(android, 5)).toBe(false);
    expect(micSharedWithRecognition(iphone, 5)).toBe(false);
    expect(micSharedWithRecognition(ipad, 5)).toBe(false);
  });

  it("is true on desktops", () => {
    const mac = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0 Safari/537.36";
    expect(micSharedWithRecognition(mac, 0)).toBe(true);
  });
});
