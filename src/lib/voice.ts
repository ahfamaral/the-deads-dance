import { languageName, type PersonaLanguage } from "@corpus/languages";

/** Spec §33.2: languages nobody speaks today; Gemini cannot voice them, so a persona with only these gets no voice. */
export const DEAD_LANGUAGES: ReadonlySet<string> = new Set(["la", "grc", "ang", "sa", "got", "non", "peo", "egy", "akk", "sux"]);

/** Spec §33.2: ISO 639-1 codes in Gemini TTS's supported list (ai.google.dev speech-generation) that also have a speech locale. */
export const TTS_LANGUAGES: ReadonlySet<string> = new Set([
  "en", "de", "pt", "fr", "es", "it", "nl", "pl", "ru", "ja", "ko", "zh", "hi", "ar", "tr", "uk",
  "af", "bg", "bn", "ca", "cs", "da", "el", "et", "fi", "he", "hr", "hu", "id", "is", "lt", "lv",
  "no", "ro", "sk", "sl", "sr", "sv", "sw", "ta", "te", "th", "vi",
]);

/** Spec §33.2: the recognition locale the browser's speech API gets for each language. */
export const SPEECH_LOCALES: Readonly<Record<string, string>> = {
  en: "en-US", pt: "pt-BR", de: "de-DE", fr: "fr-FR", es: "es-ES", it: "it-IT", nl: "nl-NL", pl: "pl-PL",
  ru: "ru-RU", ja: "ja-JP", ko: "ko-KR", zh: "zh-CN", hi: "hi-IN", ar: "ar-SA", tr: "tr-TR", uk: "uk-UA",
  af: "af-ZA", bg: "bg-BG", bn: "bn-BD", ca: "ca-ES", cs: "cs-CZ", da: "da-DK", el: "el-GR", et: "et-EE",
  fi: "fi-FI", he: "he-IL", hr: "hr-HR", hu: "hu-HU", id: "id-ID", is: "is-IS", lt: "lt-LT", lv: "lv-LV",
  no: "nb-NO", ro: "ro-RO", sk: "sk-SK", sl: "sl-SI", sr: "sr-RS", sv: "sv-SE", sw: "sw-KE", ta: "ta-IN",
  te: "te-IN", th: "th-TH", vi: "vi-VN",
};

/** Spec §33.2: Gemini's 30 prebuilt voices; character from Google's docs, gender as commonly published (the docs give none). */
export const GEMINI_VOICES: readonly { name: string; character: string; gender: "female" | "male" }[] = [
  { name: "Zephyr", character: "Bright", gender: "female" },
  { name: "Puck", character: "Upbeat", gender: "male" },
  { name: "Charon", character: "Informative", gender: "male" },
  { name: "Kore", character: "Firm", gender: "female" },
  { name: "Fenrir", character: "Excitable", gender: "male" },
  { name: "Leda", character: "Youthful", gender: "female" },
  { name: "Orus", character: "Firm", gender: "male" },
  { name: "Aoede", character: "Breezy", gender: "female" },
  { name: "Callirrhoe", character: "Easy-going", gender: "female" },
  { name: "Autonoe", character: "Bright", gender: "female" },
  { name: "Enceladus", character: "Breathy", gender: "male" },
  { name: "Iapetus", character: "Clear", gender: "male" },
  { name: "Umbriel", character: "Easy-going", gender: "male" },
  { name: "Algieba", character: "Smooth", gender: "male" },
  { name: "Despina", character: "Smooth", gender: "female" },
  { name: "Erinome", character: "Clear", gender: "female" },
  { name: "Algenib", character: "Gravelly", gender: "male" },
  { name: "Rasalgethi", character: "Informative", gender: "male" },
  { name: "Laomedeia", character: "Upbeat", gender: "female" },
  { name: "Achernar", character: "Soft", gender: "female" },
  { name: "Alnilam", character: "Firm", gender: "male" },
  { name: "Schedar", character: "Even", gender: "male" },
  { name: "Gacrux", character: "Mature", gender: "female" },
  { name: "Pulcherrima", character: "Forward", gender: "female" },
  { name: "Achird", character: "Friendly", gender: "male" },
  { name: "Zubenelgenubi", character: "Casual", gender: "male" },
  { name: "Vindemiatrix", character: "Gentle", gender: "female" },
  { name: "Sadachbia", character: "Lively", gender: "male" },
  { name: "Sadaltager", character: "Knowledgeable", gender: "male" },
  { name: "Sulafat", character: "Warm", gender: "female" },
];

export type VoiceStatus = "draft" | "approved";

export type VoiceDto = {
  baseVoice: string;
  description: string;
  sampleText: string;
  status: VoiceStatus;
  hasSample: boolean;
  updatedAt: string;
  sampleLanguage: string;
  sex: "male" | "female" | null;
  warning: string | null;
};

/** Spec §33.2: the persona's languages a voice conversation can use, in persona order (native first). */
export function voiceLanguages(languages: PersonaLanguage[]): string[] {
  return languages
    .map((l) => l.code)
    .filter((c) => !DEAD_LANGUAGES.has(c) && TTS_LANGUAGES.has(c) && c in SPEECH_LOCALES);
}

export function speechLocale(code: string): string | null {
  return SPEECH_LOCALES[code] ?? null;
}

/** The first browser language the persona also spoke, else the persona's first (native) one. */
export function defaultVoiceLanguage(options: string[], browserLanguages: readonly string[]): string {
  for (const tag of browserLanguages) {
    const primary = tag.toLowerCase().split("-")[0];
    if (options.includes(primary)) return primary;
  }
  return options[0];
}

/** Spec §33.2: the accent sentence fed into the voice description. */
export function accentLine(code: string, languages: PersonaLanguage[]): string {
  const name = languageName(code);
  const native = languages.find((l) => l.native);
  if (!native || native.code === code) return `Speaks ${name}, the native language.`;
  return `Speaks ${name} as a second language, with a noticeable ${languageName(native.code)} accent.`;
}

const fold = (s: string) => s.normalize("NFD").replace(/\p{M}/gu, "").toLowerCase();

/** Spec §33.2: the persona-name words (4+ letters) that appear in `text`, accent- and case-insensitive. */
export function nameWordsIn(text: string, personaName: string): string[] {
  const words = fold(personaName).split(/[^\p{L}]+/u).filter((w) => w.length >= 4);
  const found = new Set(fold(text).split(/[^\p{L}]+/u));
  return [...new Set(words)].filter((w) => found.has(w));
}
