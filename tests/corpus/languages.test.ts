import { describe, expect, it } from "vitest";
import {
  FALLBACK_LANGUAGES,
  languageName,
  languagesOrFallback,
  normalizeLanguages,
  parseStoredLanguages,
  sameLanguages,
} from "../../corpus/languages";

const de = { code: "de", name: "German", native: true };
const en = { code: "en", name: "English", native: false };

describe("normalizeLanguages", () => {
  it("puts the native language first and merges duplicates, native winning", () => {
    expect(normalizeLanguages([en, { ...de, native: false }, de])).toEqual([de, en]);
  });

  it("marks the first language native when none is", () => {
    expect(normalizeLanguages([{ ...en }, { code: "fr", name: "French", native: false }])[0]).toEqual({ ...en, native: true });
  });

  it("keeps an empty list empty", () => {
    expect(normalizeLanguages([])).toEqual([]);
  });
});

describe("languagesOrFallback", () => {
  it("falls back to English for null or empty", () => {
    expect(languagesOrFallback(null)).toEqual(FALLBACK_LANGUAGES);
    expect(languagesOrFallback([])).toEqual(FALLBACK_LANGUAGES);
    expect(languagesOrFallback([de, en])).toEqual([de, en]);
  });
});

describe("parseStoredLanguages", () => {
  it("accepts a valid list and rejects anything else", () => {
    expect(parseStoredLanguages([de])).toEqual([de]);
    expect(parseStoredLanguages(null)).toBeNull();
    expect(parseStoredLanguages([{ code: "deu", name: "German", native: true }])).toBeNull();
    expect(parseStoredLanguages("de")).toBeNull();
  });
});

describe("sameLanguages", () => {
  it("compares code, name and native, in order", () => {
    expect(sameLanguages([de, en], [de, en])).toBe(true);
    expect(sameLanguages([de, en], [en, de])).toBe(false);
    expect(sameLanguages(null, null)).toBe(true);
    expect(sameLanguages(null, [])).toBe(false);
  });
});

describe("languageName", () => {
  it("names a code in English, falling back to the code", () => {
    expect(languageName("ja")).toBe("Japanese");
    expect(languageName("pt")).toBe("Portuguese");
    expect(languageName("zz")).toBe("zz");
  });
});
