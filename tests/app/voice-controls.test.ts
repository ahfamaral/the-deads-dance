import { describe, expect, it } from "vitest";
import { MIC_DENIED, MIC_FAILED, turnOutcome } from "@/components/use-voice-controls";

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
