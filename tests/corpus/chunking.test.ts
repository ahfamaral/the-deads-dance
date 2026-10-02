import { describe, expect, it } from "vitest";
import { biographyText, CHUNK_SIZE, chunkArticle, splitSections } from "../../corpus/chunking";
import { paragraph, WU_TEXT } from "../fixtures/articles";

describe("splitSections", () => {
  it("names the lead Overview and keeps heading levels", () => {
    const sections = splitSections(WU_TEXT);
    expect(sections.map((s) => [s.heading, s.level])).toEqual([
      ["Overview", 1],
      ["Early life", 2],
      ["Manhattan Project", 2],
      ["Columbia", 3],
      ["See also", 2],
      ["References", 2],
      ["Citations", 3],
      ["External links", 2],
    ]);
  });
});

describe("chunkArticle", () => {
  it("drops link-list sections and their subsections", async () => {
    const headings = new Set((await chunkArticle(WU_TEXT)).map((c) => c.sectionHeading));
    expect([...headings]).toEqual(["Overview", "Early life", "Manhattan Project", "Columbia"]);
  });

  it("numbers chunks 0..n-1 across the whole article", async () => {
    const chunks = await chunkArticle(WU_TEXT);
    expect(chunks.map((c) => c.ordinal)).toEqual(chunks.map((_, i) => i));
  });

  it("caps chunk size and splits long sections", async () => {
    const chunks = await chunkArticle(WU_TEXT);
    expect(chunks.every((c) => c.content.length <= CHUNK_SIZE)).toBe(true);
    expect(chunks.filter((c) => c.sectionHeading === "Manhattan Project").length).toBeGreaterThan(1);
  });

  // Review Focus 4: short articles with no headings still ingest.
  it("puts a headingless article under Overview", async () => {
    const chunks = await chunkArticle(paragraph("Short bio", 30));
    expect(chunks.length).toBeGreaterThan(0);
    expect(chunks.every((c) => c.sectionHeading === "Overview")).toBe(true);
  });

  it("returns nothing for empty text", async () => {
    expect(await chunkArticle("  \n ")).toEqual([]);
  });
});

describe("biographyText", () => {
  it("keeps the lead and body sections with their headings, and drops link lists", () => {
    const text = biographyText(WU_TEXT);
    expect(text.startsWith("Chien-Shiung Wu was an experimental physicist.")).toBe(true);
    expect(text).toContain("== Early life ==\nEarly life sentence 1");
    expect(text).toContain("=== Columbia ===\nColumbia sentence 1");
    for (const gone of ["See also", "List of physicists", "References", "Citations", "Smith 1990", "External links", "Official site"]) {
      expect(text).not.toContain(gone);
    }
  });
});
