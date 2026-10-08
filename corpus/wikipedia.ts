import { normalizeLanguages, type PersonaLanguage } from "./languages";

export type Article = { title: string; revid: number; qid: string | null; text: string };
export type PersonFacts = { isHuman: boolean; isDeceased: boolean; description: string; lifespan: string };
export type WikipediaErrorCode = "not_found" | "disambiguation" | "unreachable";
export type FetchLike = (url: string, init?: RequestInit) => Promise<Response>;

export class WikipediaError extends Error {
  constructor(
    readonly code: WikipediaErrorCode,
    message: string,
    options?: { cause?: unknown },
  ) {
    super(message, options);
    this.name = "WikipediaError";
  }
}

export const MAX_DESCRIPTION_LENGTH = 100;
// Wikimedia asks API clients to identify themselves.
const USER_AGENT = "persona-chatbot/0.1 (Turing College student project)";
const TIMEOUT_MS = 10_000;
const HUMAN = "Q5";

async function getJson(url: URL, fetchImpl: FetchLike): Promise<unknown> {
  let response: Response;
  try {
    response = await fetchImpl(url.toString(), {
      headers: { "User-Agent": USER_AGENT },
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
  } catch (err) {
    throw new WikipediaError("unreachable", `Couldn't reach ${url.host}.`, { cause: err });
  }
  if (!response.ok) {
    throw new WikipediaError("unreachable", `${url.host} answered ${response.status}.`);
  }
  let body: unknown;
  try {
    body = await response.json();
  } catch (err) {
    throw new WikipediaError("unreachable", `${url.host} sent a response that isn't JSON.`, { cause: err });
  }
  // MediaWiki/Wikibase often report errors as HTTP 200 with `{"error":{"code":"..."}}`.
  if (typeof body !== "object" || body === null || "error" in body) {
    const errorCode = (body as { error?: { code?: unknown } } | null)?.error?.code;
    const code = typeof errorCode === "string" ? errorCode : "unknown";
    throw new WikipediaError("unreachable", `${url.host} returned an API error (${code}).`);
  }
  return body;
}

type WikiPage = {
  title: string;
  missing?: boolean;
  invalid?: boolean;
  extract?: string;
  pageprops?: { wikibase_item?: string; disambiguation?: string };
  revisions?: { revid: number }[];
};

export async function fetchArticle(title: string, fetchImpl: FetchLike = fetch): Promise<Article> {
  // The API's `titles` parameter splits on `|` to request several pages at once, and `|`
  // is not a legal MediaWiki title character, so a title containing it can never match.
  if (title.includes("|")) {
    throw new WikipediaError("not_found", `No English Wikipedia article is titled "${title}".`);
  }
  const url = new URL("https://en.wikipedia.org/w/api.php");
  url.search = new URLSearchParams({
    action: "query",
    format: "json",
    formatversion: "2",
    redirects: "1",
    prop: "extracts|pageprops|revisions",
    explaintext: "1",
    exsectionformat: "wiki",
    rvprop: "ids",
    ppprop: "wikibase_item|disambiguation",
    titles: title,
  }).toString();

  const data = (await getJson(url, fetchImpl)) as { query?: { pages?: WikiPage[] } };
  const page = data.query?.pages?.[0];
  if (!page || page.missing || page.invalid) {
    throw new WikipediaError("not_found", `No English Wikipedia article is titled "${title}".`);
  }
  if (page.pageprops && "disambiguation" in page.pageprops) {
    throw new WikipediaError("disambiguation", `"${page.title}" is a disambiguation page — try a more specific title.`);
  }
  return {
    title: page.title,
    revid: page.revisions?.[0]?.revid ?? 0,
    qid: page.pageprops?.wikibase_item ?? null,
    text: page.extract ?? "",
  };
}

type Claim = { mainsnak?: { datavalue?: { value?: { id?: string; time?: string; precision?: number } } } };
type WikidataEntity = {
  missing?: string;
  descriptions?: { en?: { value: string } };
  claims?: Record<string, Claim[]>;
};

/** A Wikidata time as a display year, or null when it is less precise than a year. */
function year(claims: Claim[] | undefined): string | null {
  const value = claims?.[0]?.mainsnak?.datavalue?.value;
  if (!value?.time || (value.precision ?? 0) < 9) return null;
  const match = /^([+-])(\d+)-/.exec(value.time);
  if (!match) return null;
  const n = Number(match[2]);
  return match[1] === "-" ? `${n} BC` : String(n);
}

export function formatLifespan(born: string | null, died: string | null): string {
  if (born && died) return `${born}–${died}`;
  if (born) return `born ${born}`;
  if (died) return `died ${died}`;
  return "";
}

export async function fetchPersonFacts(qid: string, fetchImpl: FetchLike = fetch): Promise<PersonFacts> {
  const url = new URL("https://www.wikidata.org/w/api.php");
  url.search = new URLSearchParams({
    action: "wbgetentities",
    format: "json",
    ids: qid,
    props: "claims|descriptions",
    languages: "en",
  }).toString();

  const data = (await getJson(url, fetchImpl)) as { entities?: Record<string, WikidataEntity> };
  const entity = data.entities?.[qid];
  if (!entity || entity.missing !== undefined) {
    return { isHuman: false, isDeceased: false, description: "", lifespan: "" };
  }
  const claims = entity.claims ?? {};
  const description = entity.descriptions?.en?.value ?? "";
  return {
    isHuman: (claims.P31 ?? []).some((c) => c.mainsnak?.datavalue?.value?.id === HUMAN),
    // Spec §6: any date-of-death claim counts, including "unknown value" (no datavalue).
    isDeceased: (claims.P570 ?? []).length > 0,
    // Third-party text headed for the persona prompt (spec §10), so it is capped.
    description:
      description.length > MAX_DESCRIPTION_LENGTH ? `${description.slice(0, MAX_DESCRIPTION_LENGTH - 1)}…` : description,
    lifespan: formatLifespan(year(claims.P569), year(claims.P570)),
  };
}

type LanguageClaim = { mainsnak?: { datavalue?: { value?: unknown } }; rank?: string };
type LanguageEntity = { labels?: { en?: { value: string } }; claims?: Record<string, LanguageClaim[]> };
/** wbgetentities takes at most 50 ids. */
const MAX_LANGUAGE_ITEMS = 50;

function itemIds(claims: LanguageClaim[] | undefined): string[] {
  return (claims ?? []).flatMap((c) => {
    if (c.rank === "deprecated") return []; // Wikidata's mark for a claim known to be wrong
    const value = c.mainsnak?.datavalue?.value;
    const id = typeof value === "object" && value !== null ? (value as { id?: unknown }).id : undefined;
    return typeof id === "string" ? [id] : [];
  });
}

/**
 * Spec §18.4: native language (P103) and languages spoken (P1412), resolved to ISO 639-1
 * codes (P218) and English names. Items without a code are dropped. Throws WikipediaError.
 */
export async function fetchPersonLanguages(qid: string, fetchImpl: FetchLike = fetch): Promise<PersonaLanguage[]> {
  const personUrl = new URL("https://www.wikidata.org/w/api.php");
  personUrl.search = new URLSearchParams({ action: "wbgetentities", format: "json", ids: qid, props: "claims" }).toString();
  const person = (await getJson(personUrl, fetchImpl)) as { entities?: Record<string, LanguageEntity> };
  const claims = person.entities?.[qid]?.claims ?? {};
  const native = new Set(itemIds(claims.P103));
  const ids = [...new Set([...native, ...itemIds(claims.P1412)])].slice(0, MAX_LANGUAGE_ITEMS);
  if (ids.length === 0) return [];

  const itemsUrl = new URL("https://www.wikidata.org/w/api.php");
  itemsUrl.search = new URLSearchParams({
    action: "wbgetentities",
    format: "json",
    ids: ids.join("|"),
    props: "labels|claims",
    languages: "en",
  }).toString();
  const items = (await getJson(itemsUrl, fetchImpl)) as { entities?: Record<string, LanguageEntity> };

  const languages = ids.flatMap((id): PersonaLanguage[] => {
    const entity = items.entities?.[id];
    const code = entity?.claims?.P218?.[0]?.mainsnak?.datavalue?.value;
    const name = entity?.labels?.en?.value?.trim();
    if (typeof code !== "string" || !/^[a-z]{2}$/.test(code) || !name) return [];
    return [{ code, name: name.slice(0, 40), native: native.has(id) }];
  });
  return normalizeLanguages(languages);
}
