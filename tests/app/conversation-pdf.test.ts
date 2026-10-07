import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { jsPDF } from "jspdf";
import { describe, expect, it } from "vitest";
import type { Message, ToolCall } from "@/lib/chat-types";
import { renderConversationPdf, traceLine, type PdfFonts } from "@/lib/conversation-pdf";
import type { StoredConversation } from "@/lib/conversation-types";
import { ENDED_NOTE, STOPPED_NOTE } from "@/lib/message-notes";

const font = (name: string) =>
  readFileSync(fileURLToPath(new URL(`../../public/fonts/${name}`, import.meta.url))).toString("base64");
const fonts: PdfFonts = { regular: font("DejaVuSans.ttf"), bold: font("DejaVuSans-Bold.ttf") };

const search: ToolCall = {
  id: "t1",
  toolName: "search_biography",
  arguments: { query: "parity experiment" },
  status: "ok",
  result: {
    status: "ok",
    queries: ["parity experiment"],
    passages: [{ chunk_id: 7, section_heading: "Parity", content: "In 1956 Wu…" }],
  },
  durationMs: 3400,
};

const conversation = (messages: Message[]): StoredConversation => ({
  id: "c1",
  personaId: "chien-shiung-wu",
  personaName: "Chien-Shiung Wu",
  updatedAt: "2026-09-23T10:00:00.000Z",
  messages,
});

const render = (c: StoredConversation) => renderConversationPdf(jsPDF, c, fonts);
const allText = (pages: string[][]) => pages.flat().join("\n");

describe("renderConversationPdf", () => {
  it("draws the header, both speakers and their text", () => {
    const { pages } = render(
      conversation([
        { id: "m1", role: "user", text: "What did you prove in 1956?" },
        { id: "m2", role: "persona", text: "That parity is not conserved." },
      ]),
    );
    const text = allText(pages);
    expect(text).toContain("Conversation with Chien-Shiung Wu");
    expect(text).toMatch(/Last message .*2026.* · 2 messages/);
    expect(text).toContain("You");
    expect(text).toContain("What did you prove in 1956?");
    expect(text).toContain("That parity is not conserved.");
  });

  it("includes the tool trace and the sources under a persona message", () => {
    const { pages } = render(
      conversation([
        {
          id: "m2",
          role: "persona",
          text: "We used cobalt-60.",
          toolCalls: [search],
          sources: [
            { personaId: "chien-shiung-wu", sectionHeading: "Parity", chunkId: 7 },
            { personaId: "chien-shiung-wu", sectionHeading: "Parity", chunkId: 7 },
          ],
        },
      ]),
    );
    const text = allText(pages);
    expect(text).toContain("Searched biography · “parity experiment” · 3.4 s");
    expect(text).toContain("Sources: Chien-Shiung Wu — Parity");
    expect(text).not.toContain("Parity; Chien-Shiung Wu — Parity");
  });

  it("shows why a failed call produced nothing", () => {
    const failed: ToolCall = { ...search, status: "error", result: { error: "Timed out" } };
    expect(traceLine(failed)).toBe("Searched biography · “parity experiment” · failed · 3.4 s");
    const { pages } = render(conversation([{ id: "m", role: "persona", text: "Hm.", toolCalls: [failed] }]));
    expect(allText(pages)).toContain("Timed out");
  });

  it("keeps line breaks in a message", () => {
    const { pages } = render(conversation([{ id: "m", role: "persona", text: "First line.\nSecond line." }]));
    expect(pages[0]).toEqual(expect.arrayContaining(["First line.", "Second line."]));
  });

  it("runs a long conversation over several pages, each with a footer", () => {
    const long = "The experiment took months of careful work at very low temperatures. ".repeat(12);
    const messages: Message[] = Array.from({ length: 20 }, (_, i) => ({
      id: `m${i}`,
      role: i % 2 ? "persona" : "user",
      text: long,
    }));
    const { doc, pages } = render(conversation(messages));
    expect(pages.length).toBeGreaterThan(2);
    expect(doc.getNumberOfPages()).toBe(pages.length);
    pages.forEach((page, i) => {
      expect(page.slice(-2)).toEqual(["Chien-Shiung Wu", `Page ${i + 1} of ${pages.length}`]);
    });
  });

  it("never leaves a speaker line alone at the foot of a page", () => {
    const messages: Message[] = Array.from({ length: 60 }, (_, i) => ({
      id: `m${i}`,
      role: i % 2 ? "persona" : "user",
      text: `Message ${i}`,
    }));
    const { pages } = render(conversation(messages));
    for (const page of pages) {
      const content = page.slice(0, -2); // without the footer
      expect(["You", "Chien-Shiung Wu"]).not.toContain(content.at(-1));
    }
  });

  it("keeps accented and Cyrillic text, and replaces characters the font lacks with ?", () => {
    const { pages } = render(
      conversation([{ id: "m", role: "persona", text: "Ça va, Привет. 吴健雄 👋" }]),
    );
    expect(allText(pages)).toContain("Ça va, Привет. ??? ?");
  });

  it("renders a conversation saved before traces and sources existed", () => {
    const { pages } = render(conversation([{ id: "m", role: "persona", text: "Hello." }]));
    expect(allText(pages)).toContain("Hello.");
    expect(allText(pages)).not.toContain("Sources:");
  });

  it("marks the end of the visit for every ending", () => {
    for (const ended of ["farewell", "tired", "offended"] as const) {
      const { pages } = render(
        conversation([
          { id: "m1", role: "user", text: "Goodbye." },
          { id: "m2", role: "persona", text: "Farewell.", ended },
        ]),
      );
      expect(allText(pages)).toContain("The visit has ended.");
    }
  });

  it("marks a reply cut short by Stop, before the end of the visit", () => {
    const text = allText(
      render(conversation([{ id: "m", role: "persona", text: "Fare", stopped: true, ended: "farewell" }])).pages,
    );
    expect(text).toContain(STOPPED_NOTE);
    expect(text.indexOf(STOPPED_NOTE)).toBeLessThan(text.indexOf(ENDED_NOTE));
    expect(allText(render(conversation([{ id: "m", role: "persona", text: "Done." }])).pages)).not.toContain(STOPPED_NOTE);
  });

  it("produces a PDF file", () => {
    const { doc } = render(conversation([{ id: "m", role: "user", text: "Hi" }]));
    const bytes = new Uint8Array(doc.output("arraybuffer"));
    expect(new TextDecoder().decode(bytes.subarray(0, 5))).toBe("%PDF-");
    // Subset, not the whole 750 KB font.
    expect(bytes.length).toBeLessThan(200_000);
  });
});
