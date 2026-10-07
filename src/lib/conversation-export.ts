import type { StoredConversation } from "@/lib/conversation-types";
import { ENDED_NOTE, STOPPED_NOTE } from "@/lib/message-notes";

/**
 * Turns a conversation, as the API returns it (spec §25.4), into a downloadable file. Runs entirely in the browser.
 */

export type ExportFormat = "json" | "markdown" | "pdf";

export const EXPORT_FORMATS: {
  format: ExportFormat;
  label: string;
  description: string;
}[] = [
  { format: "json", label: "JSON", description: "The conversation as-is" },
  { format: "markdown", label: "Markdown", description: "Readable transcript" },
  { format: "pdf", label: "PDF", description: "Printable, with the tool trace" },
];

function toJson(conversation: StoredConversation): string {
  return JSON.stringify(conversation, null, 2);
}

export function toMarkdown(conversation: StoredConversation): string {
  const lines = [
    `# Conversation with ${conversation.personaName}`,
    "",
    `Last message ${new Date(conversation.updatedAt).toLocaleString()}`,
    "",
    "---",
    "",
  ];
  for (const message of conversation.messages) {
    const speaker = message.role === "user" ? "You" : conversation.personaName;
    lines.push(`**${speaker}:** ${message.text}`, "");
    if (message.stopped) lines.push(`*(${STOPPED_NOTE})*`, "");
    if (message.ended) lines.push(`*(${ENDED_NOTE})*`, "");
  }
  return lines.join("\n");
}

/** e.g. "albert-einstein-2026-09-23" */
function baseFilename(conversation: StoredConversation): string {
  const slug = conversation.personaName
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
  return `${slug || "conversation"}-${conversation.updatedAt.slice(0, 10)}`;
}

function download(filename: string, contents: BlobPart, type: string) {
  const url = URL.createObjectURL(new Blob([contents], { type }));
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  link.click();
  URL.revokeObjectURL(url);
}

/**
 * The PDF renderer, jsPDF and the fonts load only when PDF is chosen, so they add
 * nothing to the page load (spec §21.1).
 */
async function toPdf(conversation: StoredConversation): Promise<ArrayBuffer> {
  const [{ jsPDF }, { renderConversationPdf, loadPdfFonts }] = await Promise.all([
    import("jspdf"),
    import("@/lib/conversation-pdf"),
  ]);
  const { doc } = renderConversationPdf(jsPDF, conversation, await loadPdfFonts());
  return doc.output("arraybuffer");
}

/** Downloads the conversation in the given format. Rejects if the PDF can't be made (spec §21.4). */
export async function exportConversation(conversation: StoredConversation, format: ExportFormat) {
  const name = baseFilename(conversation);
  switch (format) {
    case "json":
      download(`${name}.json`, toJson(conversation), "application/json");
      return;
    case "markdown":
      download(`${name}.md`, toMarkdown(conversation), "text/markdown");
      return;
    case "pdf":
      download(`${name}.pdf`, await toPdf(conversation), "application/pdf");
      return;
  }
}
