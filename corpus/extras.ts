/**
 * Spec §34.5: the four extra memory sources an admin can add to a persona: own writings
 * (Wikisource), real quotes (Wikiquote), linked articles and paragraphs on other pages
 * that mention the persona. Lists candidates with their size; nothing is ingested here.
 */
import { splitSections } from "./chunking";
import type { SourceKind, SourceRef } from "./rounds";
import { WikipediaError, type Sitelink, type WikiRef, type WikimediaClient } from "./wikimedia";

export type Candidate = SourceRef & {
  kind: Exclude<SourceKind, "article">;
  chars: number;
  /** Quotes on the page. */
  count?: number;
  /** Mention paragraphs, joined by a blank line. */
  preview?: string;
};

export const MIN_QUOTE_CHARS = 20;
export const MAX_QUOTE_CHARS = 600;
export const MAX_MENTION_PARAGRAPHS = 3;
export const MAX_LINKED = 50;

/** Section headings (prefix, case-insensitive) that hold quotes by others or doubtful ones. */
export const SKIP_QUOTE_SECTIONS: Readonly<Record<string, readonly string[]>> = {
  en: ["Misattributed", "Disputed", "Quotes about", "About"],
  pt: ["Atribuídas", "Disputadas", "Citações sobre", "Sobre"],
  fr: ["Attribuées", "Citations sur"],
  es: ["Atribuidas", "Sobre"],
  de: ["Zugeschrieben", "Über"],
};

/** Quotes under the page's real sections: one per line of 20–600 chars, deduped. The lead is skipped. */
export function extractQuotes(text: string, language: string): string[] {
  const skip = [...SKIP_QUOTE_SECTIONS.en, ...(SKIP_QUOTE_SECTIONS[language] ?? [])].map((s) => s.toLowerCase());
  const quotes = new Set<string>();
  let skippedLevel: number | null = null;
  const [, ...sections] = splitSections(text);
  for (const section of sections) {
    if (skippedLevel !== null && section.level > skippedLevel) continue;
    skippedLevel = null;
    const heading = section.heading.toLowerCase();
    if (skip.some((prefix) => heading.startsWith(prefix))) {
      skippedLevel = section.level;
      continue;
    }
    for (const line of section.body.split("\n")) {
      const quote = line.trim();
      if (quote.length >= MIN_QUOTE_CHARS && quote.length <= MAX_QUOTE_CHARS) quotes.add(quote);
    }
  }
  return [...quotes];
}

/** Each name as given, with hyphens and spaces swapped, unique. */
export function nameVariants(names: string[]): string[] {
  const variants = new Set<string>();
  for (const name of names) {
    variants.add(name);
    variants.add(name.replaceAll("-", " "));
    variants.add(name.replaceAll(" ", "-"));
  }
  return [...variants];
}

/**
 * Spec §34.5: the names a mention in this language is found by: the persona's names plus that
 * language's Wikipedia title ("Santos Dumont" on pt). The candidate list and the round share it,
 * so a previewed paragraph is the one ingested.
 */
export function mentionNames(names: string[], sitelinks: Sitelink[], language: string): string[] {
  const edition = sitelinks.find((l) => l.site === "wikipedia" && l.language === language);
  return [...new Set([...names, ...(edition ? [edition.title] : [])])];
}

const fold = (s: string) => s.normalize("NFD").replace(/\p{M}/gu, "").toLowerCase();
const escapeRegExp = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/** Up to 3 paragraphs that name the persona (any variant, whole words, ignoring accents and case). */
export function paragraphsNaming(text: string, names: string[]): string[] {
  const patterns = nameVariants(names)
    .filter((v) => v.trim())
    .map((v) => new RegExp(`(?<![\\p{L}\\p{N}])${escapeRegExp(fold(v))}(?![\\p{L}\\p{N}])`, "u"));
  const found: string[] = [];
  for (const line of text.split("\n")) {
    const paragraph = line.trim();
    if (!paragraph || /^={2,6}.*={2,6}$/.test(paragraph)) continue;
    const folded = fold(paragraph);
    if (patterns.some((p) => p.test(folded))) found.push(paragraph);
    if (found.length === MAX_MENTION_PARAGRAPHS) break;
  }
  return found;
}

/** Occurrences of the title in the article, plus 3 if it occurs in the lead. */
export function linkScore(articleText: string, title: string): number {
  if (!title) return 0;
  const lead = articleText.split(/^={2,6}/m, 1)[0];
  return articleText.split(title).length - 1 + (lead.includes(title) ? 3 : 0);
}

/** Wikisource author pages: the writings they link to. */
export async function listWritings(client: WikimediaClient, sitelinks: Sitelink[]): Promise<Candidate[]> {
  const candidates: Candidate[] = [];
  for (const link of sitelinks.filter((l) => l.site === "wikisource")) {
    const ref: WikiRef = { site: link.site, language: link.language };
    const titles = [...new Set(await client.links(ref, link.title))];
    const lengths = await client.pageLengths(ref, titles);
    for (const title of titles) {
      const chars = lengths.get(title);
      if (chars !== undefined) candidates.push({ kind: "writing", site: ref.site, language: ref.language, title, chars });
    }
  }
  return candidates;
}

/** One candidate per Wikiquote page that has any quotes. */
export async function listQuotes(client: WikimediaClient, sitelinks: Sitelink[]): Promise<Candidate[]> {
  const candidates: Candidate[] = [];
  for (const link of sitelinks.filter((l) => l.site === "wikiquote")) {
    let text: string;
    try {
      text = (await client.extract({ site: link.site, language: link.language }, link.title)).text;
    } catch (err) {
      if (err instanceof WikipediaError && err.code !== "unreachable") continue;
      throw err;
    }
    const quotes = extractQuotes(text, link.language);
    if (quotes.length === 0) continue;
    const chars = quotes.reduce((sum, q) => sum + q.length, 0);
    candidates.push({ kind: "quotes", site: link.site, language: link.language, title: link.title, chars, count: quotes.length });
  }
  return candidates;
}

const MONTHS =
  "january|february|march|april|may|june|july|august|september|october|november|december|janeiro|fevereiro|março|abril|maio|junho|julho|agosto|setembro|outubro|novembro|dezembro|janvier|février|mars|avril|mai|juin|juillet|août|septembre|octobre|novembre|décembre|enero|febrero|marzo|mayo|junio|julio|septiembre|octubre|noviembre|diciembre|januar|februar|märz|juni|juli|oktober|dezember";
const DATE_TITLE = new RegExp(
  `^(\\d{1,2}(º|er|\\.)?( (de|of|d'))? ?(${MONTHS})|(${MONTHS}) \\d{1,2})$`,
  "iu",
);
const LIST_TITLE = /^(list of|lista de|liste|lista)\b/i;
const isGenericTitle = (title: string) => /^\d+$/.test(title.trim()) || DATE_TITLE.test(title.trim()) || LIST_TITLE.test(title.trim());

/** The article's links minus years, dates and lists, the 50 most mentioned first. */
export async function listLinked(
  client: WikimediaClient,
  ref: WikiRef,
  articleTitle: string,
  articleText: string,
): Promise<Candidate[]> {
  const titles = [...new Set(await client.links(ref, articleTitle))].filter((t) => t !== articleTitle && !isGenericTitle(t));
  const top = titles
    .map((title) => ({ title, score: linkScore(articleText, title) }))
    .sort((a, b) => b.score - a.score)
    .slice(0, MAX_LINKED)
    .map((t) => t.title);
  const lengths = await client.pageLengths(ref, top);
  return top.flatMap((title) => {
    const chars = lengths.get(title);
    return chars === undefined ? [] : [{ kind: "linked" as const, site: ref.site, language: ref.language, title, chars }];
  });
}

/**
 * Pages that link to the persona or turn up in a phrase search for their names, minus the
 * persona's own page; pages in both lists first, then search order, then backlinks. The
 * window is read, and a page is kept only if a paragraph in it names the persona. `total`
 * counts all pages found, before reading.
 */
export async function listMentions(
  client: WikimediaClient,
  ref: WikiRef,
  personaTitle: string,
  names: string[],
  offset: number,
  limit: number,
): Promise<{ items: Candidate[]; total: number }> {
  const backlinks = await client.backlinks(ref, personaTitle, 500);
  const searched: string[] = [];
  for (const name of names) searched.push(...(await client.search(ref, name, 100)));
  const searchOrder = [...new Set(searched)];
  const linking = new Set(backlinks);
  const searchSet = new Set(searchOrder);
  const ordered = [
    ...searchOrder.filter((t) => linking.has(t)),
    ...searchOrder.filter((t) => !linking.has(t)),
    ...[...linking].filter((t) => !searchSet.has(t)),
  ].filter((t) => t !== personaTitle);

  const items: Candidate[] = [];
  for (const title of ordered.slice(offset, offset + limit)) {
    let text: string;
    try {
      text = (await client.extract(ref, title)).text;
    } catch (err) {
      if (err instanceof WikipediaError && err.code !== "unreachable") continue;
      throw err;
    }
    const candidate = mentionCandidate(ref, title, text, names);
    if (candidate) items.push(candidate);
  }
  return { items, total: ordered.length };
}

/** A page as a mention candidate: its paragraphs naming the persona as the preview, or null when none does. */
export function mentionCandidate(ref: WikiRef, title: string, text: string, names: string[]): Candidate | null {
  const paragraphs = paragraphsNaming(text, names);
  if (paragraphs.length === 0) return null;
  const preview = paragraphs.join("\n\n");
  return { kind: "mention", site: ref.site, language: ref.language, title, chars: preview.length, preview };
}
