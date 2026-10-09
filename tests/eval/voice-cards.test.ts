import { describe, expect, it } from "vitest";
import { overwriteRefusal, voiceCardMessage } from "../../eval/generate-voice-cards";
import { loadVoiceCards, parseVoiceCards } from "../../eval/voice-cards";

describe("voice cards (spec §30.3 V5)", () => {
  it("parses a map of display name to card, and refuses an empty or overlong card", () => {
    expect(parseVoiceCards({ "Albert Einstein": "Short, wry sentences." })).toEqual({ "Albert Einstein": "Short, wry sentences." });
    expect(() => parseVoiceCards({ "Albert Einstein": "" })).toThrow();
    expect(() => parseVoiceCards({ "Albert Einstein": "x".repeat(701) })).toThrow();
  });
  it("says how to make the file when it is missing", () => {
    expect(() => loadVoiceCards("eval/no-such-file.json")).toThrow(/npm run eval:voice-cards/);
  });
  it("gives the generator the persona's profile and biography as data, without angle brackets", () => {
    const profile = { temperament: "unknown", humour: "unknown", passions: "unknown", indifferences: "unknown", speech: "Quiet, exact", sore_points: "unknown" };
    const msg = voiceCardMessage({ displayName: "Marie Curie", lifespan: "1867–1934", profile } as never, "Born in <Warsaw>.");
    expect(msg).not.toContain("temperament");
    expect(msg).toContain("Marie Curie (1867–1934)");
    expect(msg).toContain("speech: Quiet, exact");
    expect(msg).toContain("Born in Warsaw.");
  });
  it("won't overwrite reviewed cards unless asked (final review #7)", () => {
    expect(overwriteRefusal("package.json", [])).toMatch(/already exists.*--overwrite/);
    expect(overwriteRefusal("package.json", ["--overwrite"])).toBeNull();
    expect(overwriteRefusal("eval/no-such-file.json", [])).toBeNull();
  });
});
