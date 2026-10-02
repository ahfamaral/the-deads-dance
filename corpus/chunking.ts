import { RecursiveCharacterTextSplitter } from "@langchain/textsplitters";

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
const dropped = new Set(DROPPED_SECTIONS.map((s) => s.toLowerCase()));

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
function contentSections(sections: Section[]): Section[] {
  const kept: Section[] = [];
  let droppedLevel: number | null = null;
  for (const section of sections) {
    if (droppedLevel !== null && section.level > droppedLevel) continue;
    droppedLevel = null;
    if (dropped.has(section.heading.toLowerCase())) {
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

export async function chunkArticle(text: string): Promise<Chunk[]> {
  const splitter = new RecursiveCharacterTextSplitter({ chunkSize: CHUNK_SIZE, chunkOverlap: CHUNK_OVERLAP });
  const chunks: Chunk[] = [];
  for (const section of contentSections(splitSections(text))) {
    for (const content of await splitter.splitText(section.body)) {
      chunks.push({ sectionHeading: section.heading, ordinal: chunks.length, content });
    }
  }
  return chunks;
}
