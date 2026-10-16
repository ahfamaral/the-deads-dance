import { describe, expect, it } from "vitest";
import {
  GEMINI_VOICES,
  SPEECH_LOCALES,
  TTS_LANGUAGES,
  accentLine,
  defaultVoiceLanguage,
  nameWordsIn,
  speechLocale,
  voiceLanguages,
} from "@/lib/voice";

describe("voice language rules (spec §33.2)", () => {
  it("keeps spoken, supported languages in order and drops dead ones", () => {
    expect(voiceLanguages([{ code: "de", name: "German", native: true }, { code: "en", name: "English", native: false }, { code: "la", name: "Latin", native: false }])).toEqual(["de", "en"]);
  });
  it("offers nothing for a persona with only dead languages", () => {
    expect(voiceLanguages([{ code: "la", name: "Latin", native: true }])).toEqual([]);
  });
  it("lists a repeated language once", () => {
    expect(voiceLanguages([{ code: "de", name: "German", native: true }, { code: "en", name: "English", native: false }, { code: "de", name: "German", native: false }])).toEqual(["de", "en"]);
  });
  it("has no default language without options", () => expect(defaultVoiceLanguage([], ["en"])).toBeNull());
  it("maps Portuguese to Brazilian Portuguese for recognition", () => expect(speechLocale("pt")).toBe("pt-BR"));
  it("has no locale for an unknown code", () => expect(speechLocale("xx")).toBeNull());
  it("defaults to the browser's language when the persona spoke it", () => {
    expect(defaultVoiceLanguage(["de", "en"], ["en-GB", "fr"])).toBe("en");
    expect(defaultVoiceLanguage(["de", "en"], ["fr"])).toBe("de");
  });
  it("writes native and second-language accent lines", () => {
    const einstein = [{ code: "de", name: "German", native: true }, { code: "en", name: "English", native: false }];
    expect(accentLine("de", einstein)).toBe("Speaks German, the native language.");
    expect(accentLine("en", einstein)).toBe("Speaks English as a second language, with a noticeable German accent.");
  });
  it("finds name words regardless of case and accents", () => {
    expect(nameWordsIn("A man from santos, near DUMONT's farm", "Alberto Santos-Dumont")).toEqual(["santos", "dumont"]);
    expect(nameWordsIn("A calm man", "Alberto Santos-Dumont")).toEqual([]);
  });
  it("lists 30 Gemini voices", () => expect(GEMINI_VOICES).toHaveLength(30));
  it("gives every TTS language a locale", () => {
    for (const c of TTS_LANGUAGES) expect(SPEECH_LOCALES[c]).toBeTruthy();
  });
});
