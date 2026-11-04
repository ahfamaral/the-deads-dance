import { RecursiveCharacterTextSplitter } from "@langchain/textsplitters";
import type { SourceKind } from "./rounds";

export const CHUNK_SIZE = 1000;
export const CHUNK_OVERLAP = 200;
/** Sections that are lists of links rather than biography. Matched case-insensitively. */
export const DROPPED_SECTIONS: readonly string[] = [
  "References",
  "External links",
  "See also",
  "Further reading",
  "Notes",
];

const LEAD_HEADING = "Overview";
// "== Early life ==" or "=== Berkeley ===" on a line of its own.
const HEADING = /^(={2,6})\s*(.+?)\s*\1\s*$/;
/** Spec §34.5: link-list section names in other languages, dropped in addition to the English ones. */
export const DROPPED_SECTIONS_BY_LANGUAGE: Readonly<Record<string, readonly string[]>> = {
  pt: ["Referências", "Ligações externas", "Ver também", "Notas", "Bibliografia"],
  fr: ["Références", "Liens externes", "Voir aussi", "Notes", "Bibliographie"],
  es: ["Referencias", "Enlaces externos", "Véase también", "Notas", "Bibliografía"],
  de: ["Einzelnachweise", "Weblinks", "Siehe auch", "Anmerkungen", "Literatur"],
};

const droppedFor = (language: string): Set<string> =>
  new Set([...DROPPED_SECTIONS, ...(DROPPED_SECTIONS_BY_LANGUAGE[language] ?? [])].map((s) => s.toLowerCase()));
const dropped = droppedFor("en");

export type Section = { heading: string; level: number; body: string };
export type Chunk = { sectionHeading: string; ordinal: number; content: string };

/** Splits a plain-text extract on its `==` headings. Empty sections are kept. */
export function splitSections(text: string): Section[] {
  const sections: Section[] = [];
  let current = { heading: LEAD_HEADING, level: 1, lines: [] as string[] };
  const finish = () => sections.push({ heading: current.heading, level: current.level, body: current.lines.join("\n").trim() });

  for (const line of text.split("\n")) {
    const match = HEADING.exec(line);
    if (match) {
      finish();
      current = { heading: match[2], level: match[1].length, lines: [] };
    } else {
      current.lines.push(line);
    }
  }
  finish();
  return sections;
}

/** Drops link-list sections together with their subsections (e.g. References › Citations). */
function contentSections(sections: Section[], droppedNames: Set<string> = dropped): Section[] {
  const kept: Section[] = [];
  let droppedLevel: number | null = null;
  for (const section of sections) {
    if (droppedLevel !== null && section.level > droppedLevel) continue;
    droppedLevel = null;
    if (droppedNames.has(section.heading.toLowerCase())) {
      droppedLevel = section.level;
      continue;
    }
    if (section.body) kept.push(section);
  }
  return kept;
}

/** Spec §17.1: what the profile generator reads — the article without link-list sections, headings kept. */
export function biographyText(text: string): string {
  return contentSections(splitSections(text))
    .map((s) => (s.level === 1 ? s.body : `${"=".repeat(s.level)} ${s.heading} ${"=".repeat(s.level)}\n${s.body}`))
    .join("\n\n");
}

export async function chunkArticle(text: string, language = "en"): Promise<Chunk[]> {
  const splitter = new RecursiveCharacterTextSplitter({ chunkSize: CHUNK_SIZE, chunkOverlap: CHUNK_OVERLAP });
  const chunks: Chunk[] = [];
  for (const section of contentSections(splitSections(text), droppedFor(language))) {
    for (const content of await splitter.splitText(section.body)) {
      chunks.push({ sectionHeading: section.heading, ordinal: chunks.length, content });
    }
  }
  return chunks;
}

/**
 * Spec §34.5: chunks one source by its kind. Writings and linked articles are chunked like
 * articles under `title: section` (the lead under `title`). For `quotes`, `text` holds one
 * quote per line (what `extractQuotes` returns, joined by newlines); for `mention`, one
 * paragraph per line. Each becomes one chunk under `title`.
 */
export async function chunkSource(kind: SourceKind, title: string, text: string, language: string): Promise<Chunk[]> {
  if (kind === "article") return chunkArticle(text, language);
  if (kind === "quotes" || kind === "mention") {
    return text
      .split("\n")
      .map((line) => line.trim())
      .filter(Boolean)
      .map((content, ordinal) => ({ sectionHeading: title, ordinal, content }));
  }
  return (await chunkArticle(text, language)).map((c) => ({
    ...c,
    sectionHeading: c.sectionHeading === LEAD_HEADING ? title : `${title}: ${c.sectionHeading}`,
  }));
}
