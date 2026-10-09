import { OPENER_PHRASES } from "./checks";

/** Spec §30.3: markdown a persona never writes, removed from a finished reply. Ordinary asterisks and underscores stay. */
export function stripMarkdown(text: string): string {
  return text
    .replace(/\*\*([^*\n]+)\*\*/g, "$1")
    .replace(/(^|[\s(])\*([^*\s][^*\n]*?)\*(?=[\s.,;:!?)]|$)/gm, "$1$2")
    .replace(/(^|[\s(])_([^_\n]+)_(?=[\s.,;:!?)]|$)/gm, "$1$2")
    .replace(/^[ \t]*#{1,6}[ \t]+/gm, "")
    .replace(/^[ \t]*[-•][ \t]+/gm, "")
    .replace(/^[ \t]*\d{1,2}\.[ \t]+/gm, "");
}

/**
 * Spec §30.3: a first clause announcing a lookup or a pause is dropped; a reply that is nothing else is kept.
 * The clause ends at a sentence end, a colon or a dash, so the facts after "Let me search my memory:" stay.
 */
export function dropOpener(text: string): string {
  const clause = /^\s*[^.!?:—–\n]*(?:[.!?]+["')\]]*|[:—–])\s*/.exec(text);
  if (!clause) return text;
  if (!OPENER_PHRASES.some((p) => clause[0].toLowerCase().includes(p))) return text;
  const rest = text.slice(clause[0].length).trimStart();
  return rest ? rest[0].toUpperCase() + rest.slice(1) : text;
}

export function applyGuards(text: string): string {
  return dropOpener(stripMarkdown(text));
}
