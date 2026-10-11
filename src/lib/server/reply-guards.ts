/** Openers that announce a lookup or a pause (§28 known issue; seen in the baseline). */
// "let me look" alone would catch an in-character "let me look at you" (final review #3).
export const OPENER_PHRASES = ["search my memory", "let me search", "let me check", "let me look into", "let me look it up", "gather my thoughts"] as const;

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
/** The first clause: up to a sentence end (an ellipsis "…" included, as in trimToSentence), a colon or a dash. */
const FIRST_CLAUSE = /^\s*[^.!?…:—–\n]*(?:[.!?…]+["')\]]*|[:—–])\s*/;

export function dropOpener(text: string): string {
  const clause = FIRST_CLAUSE.exec(text);
  if (!clause) return text;
  if (!OPENER_PHRASES.some((p) => clause[0].toLowerCase().includes(p))) return text;
  const rest = text.slice(clause[0].length).trimStart();
  return rest ? rest[0].toUpperCase() + rest.slice(1) : text;
}

/** Spec §30.7: the guards on a finished reply; the stored message is this text. */
export function applyGuards(text: string): string {
  return dropOpener(stripMarkdown(text));
}

/** Spec §30.7: before this many characters the first sentence is held back, so an opener can still be dropped. */
const FIRST_SENTENCE_LIMIT = 300;
/** A line's first characters stay back until they can't be a heading, a bullet or a numbered item. */
const LINE_START_HOLD = 8;
/** The first clause is done when dropOpener's own clause match is followed by more text (final review #1: "..." or "?!"). */
function firstClauseDone(text: string): boolean {
  const clause = FIRST_CLAUSE.exec(text);
  return clause !== null && text.length > clause[0].length;
}

/**
 * Where the text stops being safe to show. stripMarkdown's patterns never cross a line, so a finished
 * line is safe; on the line still arriving, hold back its first characters (a heading, a bullet or a
 * number may be starting) and everything from its first * or word-start _ (emphasis may be opening).
 */
function safeLength(raw: string): number {
  const lineStart = raw.lastIndexOf("\n") + 1;
  const line = raw.slice(lineStart);
  if (line.length < LINE_START_HOLD) return lineStart;
  const marks = [line.indexOf("*"), line.search(/(?:^|[\s(])_/)].filter((i) => i >= 0);
  return marks.length ? lineStart + Math.min(...marks) : raw.length;
}

/**
 * Spec §30.7: the guards on a streaming reply. Shows only text that the finished, guarded reply
 * will begin with: the first sentence waits until it ends (so an opener can be dropped), and a
 * line's start or an open * or _ waits until it can't turn into markdown. The finished message
 * carries applyGuards' text and replaces what was streamed.
 */
export function createStreamGuard(): { push(chunk: string): string; finish(final: string): string } {
  let raw = "";
  let shown = "";
  const show = (text: string): string => {
    if (!text.startsWith(shown)) return "";
    const delta = text.slice(shown.length);
    shown = text;
    return delta;
  };
  return {
    push(chunk) {
      raw += chunk;
      // The same order as applyGuards: markdown first, so "1. " or "**" can't pass for a sentence's end.
      const stripped = stripMarkdown(raw.slice(0, safeLength(raw)));
      if (!firstClauseDone(stripped) && raw.length < FIRST_SENTENCE_LIMIT) return "";
      return show(dropOpener(stripped));
    },
    finish(final) {
      return show(final);
    },
  };
}
