// Splits a streamed reply into chunks that are good to send to text-to-speech.
// A sentence end counts only once whitespace follows the terminator, so a
// token boundary never splits "Dr." from "Weber".

const TERMINATORS = new Set([".", "!", "?", "…", "。"]);
const ABBREVIATIONS = new Set(
  ["dr", "mr", "mrs", "ms", "st", "prof", "sr", "sra", "jr", "nr", "hr", "fr"],
);

// Index just after the first confirmed sentence end in `text`, or -1.
function findSentenceEnd(text: string): number {
  for (let i = 0; i < text.length - 1; i++) {
    if (!TERMINATORS.has(text[i]) || !/\s/.test(text[i + 1])) continue;
    if (text[i] === "." && endsWithAbbreviation(text.slice(0, i))) continue;
    return i + 1;
  }
  return -1;
}

function endsWithAbbreviation(beforeDot: string): boolean {
  const word = /(?:^|[^\p{L}])(\p{L}+)$/u.exec(beforeDot)?.[1];
  if (!word) return false;
  return ABBREVIATIONS.has(word.toLowerCase()) || /^\p{Lu}$/u.test(word);
}

export function createChunker(maxChars = 300): {
  push(text: string): string[];
  flush(): string | null;
} {
  let buffer = ""; // text not yet part of a completed sentence
  let group = ""; // completed sentences waiting to be sent together
  let firstSent = false;

  function addSentence(sentence: string, out: string[]) {
    if (!firstSent) {
      out.push(sentence);
      firstSent = true;
    } else if (!group) {
      group = sentence;
    } else if (group.length + 1 + sentence.length > maxChars) {
      out.push(group);
      group = sentence;
    } else {
      group += " " + sentence;
    }
  }

  return {
    push(text) {
      buffer += text;
      const out: string[] = [];
      for (;;) {
        const end = findSentenceEnd(buffer);
        if (end !== -1 && end <= maxChars) {
          addSentence(buffer.slice(0, end), out);
          buffer = buffer.slice(end).trimStart();
        } else if (buffer.length > maxChars) {
          // Too long for one chunk: send what is waiting, then cut at a word.
          const space = buffer.lastIndexOf(" ", maxChars);
          const cut = space > 0 ? space : maxChars;
          if (group) out.push(group);
          group = "";
          out.push(buffer.slice(0, cut).trim());
          firstSent = true;
          buffer = buffer.slice(cut).trimStart();
        } else {
          break;
        }
      }
      return out;
    },
    flush() {
      const rest = [group, buffer.trim()].filter(Boolean).join(" ");
      group = "";
      buffer = "";
      return rest || null;
    },
  };
}
