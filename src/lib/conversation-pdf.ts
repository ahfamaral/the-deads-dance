import type { jsPDF } from "jspdf";
import type { Message, ToolCall } from "@/lib/chat-types";
import { voiceMarker, type StoredConversation } from "@/lib/conversation-types";
import { ENDED_NOTE, STOPPED_NOTE } from "@/lib/message-notes";
import {
  explanationOf,
  GENERAL_KNOWLEDGE_NOTE,
  MIXED_SOURCES_NOTE,
  problemOf,
  recalledOf,
  recalledYear,
  toolLabel,
  toolSubject,
  usesGeneralKnowledge,
  VERDICT_LABELS,
  verdictOf,
} from "@/lib/tool-display";

/**
 * Draws a saved conversation as a PDF (spec §21). Takes the jsPDF class and the
 * font files as arguments and touches no browser API, so tests run it in Node.
 */

/** DejaVu Sans as base64, regular and bold (spec §21.1). */
export type PdfFonts = { regular: string; bold: string };

export const PDF_FONT_FILES = { regular: "/fonts/DejaVuSans.ttf", bold: "/fonts/DejaVuSans-Bold.ttf" };

const FONT = "DejaVuSans";
const PAGE = { width: 210, height: 297, margin: 18 };
const BODY_WIDTH = PAGE.width - 2 * PAGE.margin;
/** Text stops here; the footer sits below it. */
const BOTTOM = PAGE.height - PAGE.margin - 4;
const FOOTER_Y = PAGE.height - 10;
const TRACE_INDENT = 4;
const PT_TO_MM = 25.4 / 72;

const COLORS = {
  text: "#1f1f1f",
  muted: "#6b6b6b",
  persona: "#3b4a8a",
  warning: "#9a6700",
} as const;

type Style = { size: number; bold?: boolean; color?: string; indent?: number };

const STYLES = {
  title: { size: 18, bold: true },
  meta: { size: 9.5, color: COLORS.muted },
  speaker: { size: 10.5, bold: true },
  body: { size: 10.5 },
  trace: { size: 8.5, color: COLORS.muted, indent: TRACE_INDENT },
  traceDetail: { size: 8.5, color: COLORS.muted, indent: 2 * TRACE_INDENT },
  note: { size: 8.5, color: COLORS.warning },
  footer: { size: 8, color: COLORS.muted },
} satisfies Record<string, Style>;

export type RenderedPdf = {
  doc: jsPDF;
  /** The text drawn on each page, in order: jsPDF writes embedded-font text as glyph ids. */
  pages: string[][];
};

/** "3.4 s", as the chat's trace shows it. */
function seconds(ms: number): string {
  return `${(ms / 1000).toFixed(1)} s`;
}

/** One line per tool call: label, subject, verdict or problem, duration. */
export function traceLine(call: ToolCall): string {
  const parts = [toolLabel(call.toolName)];
  const subject = toolSubject(call);
  if (subject) parts.push(`“${subject}”`);
  const verdict = verdictOf(call);
  if (verdict) parts.push(VERDICT_LABELS[verdict]);
  if (problemOf(call)) parts.push(call.status === "error" ? "failed" : "no result");
  if (call.durationMs !== undefined) parts.push(seconds(call.durationMs));
  return parts.join(" · ");
}

function formatDate(iso: string): string {
  const date = new Date(iso);
  return Number.isNaN(date.getTime())
    ? iso
    : date.toLocaleString("en-GB", { dateStyle: "long", timeStyle: "short" });
}

export function renderConversationPdf(
  JsPdf: typeof jsPDF,
  conversation: StoredConversation,
  fonts: PdfFonts,
): RenderedPdf {
  const doc = new JsPdf({ unit: "mm", format: "a4", compress: true });
  doc.addFileToVFS(`${FONT}.ttf`, fonts.regular);
  doc.addFont(`${FONT}.ttf`, FONT, "normal", "Identity-H");
  doc.addFileToVFS(`${FONT}-Bold.ttf`, fonts.bold);
  doc.addFont(`${FONT}-Bold.ttf`, FONT, "bold", "Identity-H");
  doc.setProperties({ title: `Conversation with ${conversation.personaName}` });

  const pages: string[][] = [[]];
  let y = PAGE.margin;

  const setStyle = (style: Style) => {
    doc.setFont(FONT, style.bold ? "bold" : "normal");
    doc.setFontSize(style.size);
    doc.setTextColor(style.color ?? COLORS.text);
  };

  /** Characters the active font has no glyph for become "?" rather than blank boxes (spec §21.1). */
  const printable = (text: string): string => {
    const font = doc.getFont() as { metadata?: { characterToGlyph(code: number): number } };
    const metadata = font.metadata;
    let out = "";
    for (const char of text.replace(/\t/g, "    ")) {
      const code = char.codePointAt(0)!;
      const covered = code <= 0xffff && (!metadata || metadata.characterToGlyph(code) !== 0);
      out += covered ? char : "?";
    }
    return out;
  };

  const lineHeight = (style: Style) => style.size * PT_TO_MM * 1.45;

  const newPage = () => {
    doc.addPage();
    pages.push([]);
    y = PAGE.margin;
  };

  /** Wraps the text, keeping its own line breaks. */
  const wrap = (text: string, style: Style): string[] => {
    setStyle(style);
    const width = BODY_WIDTH - (style.indent ?? 0);
    return text
      .replace(/\r\n?/g, "\n")
      .split("\n")
      .flatMap((paragraph) =>
        paragraph.trim() === "" ? [""] : (doc.splitTextToSize(printable(paragraph), width) as string[]),
      );
  };

  const write = (text: string, style: Style, { keepWith = 0 }: { keepWith?: number } = {}) => {
    const lines = wrap(text, style);
    const height = lineHeight(style);
    // Keep this block's first line together with the start of what follows (a speaker and their text).
    if (y + height + keepWith > BOTTOM) newPage();
    for (const line of lines) {
      if (y + height > BOTTOM) newPage();
      setStyle(style);
      if (line) doc.text(line, PAGE.margin + (style.indent ?? 0), y, { baseline: "top" });
      pages[pages.length - 1].push(line);
      y += height;
    }
  };

  const gap = (mm: number) => {
    y += mm;
  };

  // Header
  if (conversation.voiceLanguage) write(voiceMarker(conversation.voiceLanguage), STYLES.meta);
  write(`Conversation with ${conversation.personaName}`, STYLES.title);
  gap(1);
  const count = conversation.messages.length;
  write(`Last message ${formatDate(conversation.updatedAt)} · ${count} ${count === 1 ? "message" : "messages"}`, STYLES.meta);
  gap(3);
  doc.setDrawColor("#d4d4d4");
  doc.setLineWidth(0.2);
  doc.line(PAGE.margin, y, PAGE.width - PAGE.margin, y);
  gap(6);

  for (const message of conversation.messages) {
    writeMessage(message);
    gap(5);
  }

  function writeMessage(message: Message) {
    const isUser = message.role === "user";
    const speakerStyle = { ...STYLES.speaker, color: isUser ? COLORS.text : COLORS.persona };
    write(isUser ? "You" : conversation.personaName, speakerStyle, { keepWith: lineHeight(STYLES.body) });
    gap(0.8);

    // The trace comes before the reply, as in the chat.
    for (const call of message.toolCalls ?? []) {
      write(traceLine(call), STYLES.trace);
      const problem = problemOf(call);
      if (problem) write(problem, { ...STYLES.traceDetail, color: COLORS.warning });
      const explanation = explanationOf(call);
      if (explanation) write(explanation, STYLES.traceDetail);
      const recalled = recalledOf(call);
      if (recalled) {
        const year = recalledYear(recalled.year);
        write(year ? `${year}: ${recalled.account}` : recalled.account, STYLES.traceDetail);
        write(GENERAL_KNOWLEDGE_NOTE, { ...STYLES.traceDetail, color: COLORS.warning });
      }
    }
    if (message.toolCalls?.length) gap(1.5);

    write(message.text, STYLES.body);

    if (message.stopped) {
      gap(1);
      write(STOPPED_NOTE, { ...STYLES.trace, indent: 0 });
    }
    if (message.ended) {
      gap(1);
      write(ENDED_NOTE, { ...STYLES.trace, indent: 0 });
    }

    const sources = [...new Map((message.sources ?? []).map((s) => [s.chunkId, s])).values()];
    if (sources.length > 0) {
      gap(1.5);
      write(
        `Sources: ${sources.map((s) => `${conversation.personaName} — ${s.sectionHeading}`).join("; ")}`,
        { ...STYLES.trace, indent: 0 },
      );
      if (usesGeneralKnowledge(message)) write(MIXED_SOURCES_NOTE, STYLES.note);
    }
  }

  // Footer on every page, once the page count is known.
  const total = pages.length;
  for (let page = 1; page <= total; page++) {
    doc.setPage(page);
    setStyle(STYLES.footer);
    const left = printable(conversation.personaName);
    const right = `Page ${page} of ${total}`;
    doc.text(left, PAGE.margin, FOOTER_Y);
    doc.text(right, PAGE.width - PAGE.margin, FOOTER_Y, { align: "right" });
    pages[page - 1].push(left, right);
  }

  return { doc, pages };
}

function toBase64(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer);
  let binary = "";
  for (let i = 0; i < bytes.length; i += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  }
  return btoa(binary);
}

/** Fetches the two font files from public/fonts (browser only). */
export async function loadPdfFonts(): Promise<PdfFonts> {
  const load = async (url: string) => {
    const response = await fetch(url);
    if (!response.ok) throw new Error(`Couldn't load ${url} (${response.status})`);
    return toBase64(await response.arrayBuffer());
  };
  const [regular, bold] = await Promise.all([load(PDF_FONT_FILES.regular), load(PDF_FONT_FILES.bold)]);
  return { regular, bold };
}
