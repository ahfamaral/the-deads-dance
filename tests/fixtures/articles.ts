import type { Article } from "../../corpus/wikipedia";

/** About 50 characters per sentence. */
export function paragraph(topic: string, sentences = 12): string {
  return Array.from({ length: sentences }, (_, i) => `${topic} sentence ${i + 1} describes the work.`).join(" ");
}

/** Shaped like a real Wikipedia plain-text extract with exsectionformat=wiki. */
export const WU_TEXT = [
  `Chien-Shiung Wu was an experimental physicist. ${paragraph("Lead")}`,
  "",
  "== Early life ==",
  paragraph("Early life"),
  "",
  "== Manhattan Project ==",
  paragraph("Manhattan", 60),
  "",
  "=== Columbia ===",
  paragraph("Columbia"),
  "",
  "== See also ==",
  "List of physicists",
  "",
  "== References ==",
  "",
  "=== Citations ===",
  "Smith 1990, p. 4.",
  "",
  "== External links ==",
  "Official site",
].join("\n");

export function article(overrides: Partial<Article> = {}): Article {
  return { title: "Chien-Shiung Wu", revid: 1374160316, qid: "Q450317", text: WU_TEXT, ...overrides };
}
