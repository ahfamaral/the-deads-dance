/**
 * Spec §34.6: a throttled client for Wikimedia sites in any language (Wikipedia, Wikiquote,
 * Wikisource) and Wikidata. Requests are spaced out and retried on HTTP 429, with the
 * project's User-Agent. Only Wikimedia hosts: no fan sites or news.
 */
export type Article = { title: string; revid: number; qid: string | null; text: string };
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

export type WikiSite = "wikipedia" | "wikiquote" | "wikisource";
export type WikiRef = { site: WikiSite; language: string };
export type Sitelink = WikiRef & { title: string; badges: ("featured" | "good")[] };

export type WikimediaClient = {
  getJson(url: URL): Promise<unknown>;
  extract(ref: WikiRef, title: string): Promise<Article>;
  sitelinks(qid: string): Promise<Sitelink[]>;
  links(ref: WikiRef, title: string): Promise<string[]>;
  backlinks(ref: WikiRef, title: string, limit: number): Promise<string[]>;
  search(ref: WikiRef, phrase: string, limit: number): Promise<string[]>;
  pageLengths(ref: WikiRef, titles: string[]): Promise<Map<string, number>>;
};

export function wikiHost(ref: WikiRef): string {
  return `${ref.language}.${ref.site}.org`;
}

// Wikimedia asks API clients to identify themselves.
export const USER_AGENT = "persona-chatbot/0.1 (Turing College student project)";
const TIMEOUT_MS = 10_000;
const DEFAULT_GAP_MS = 200;
const MAX_TRIES = 3;
const DEFAULT_RETRY_MS = [2000, 4000];
/** The API takes at most 50 titles per request. */
const TITLES_PER_REQUEST = 50;
// Wikidata site keys: "ptwiki", "ptwikiquote", "frwikisource", "zh_min_nanwiki".
const SITELINK_KEY = /^([a-z_]+?)wiki(quote|source)?$/;
const SITE_BY_SUFFIX: Record<string, WikiSite> = { quote: "wikiquote", source: "wikisource" };
/** Language codes are 2 to 3 letters, `simple`, or carry an underscore (`zh_min_nan`). */
const LANGUAGE_CODE = /^(?:[a-z]{2,3}|simple|[a-z]+(?:_[a-z]+)+)$/;
const BADGES: Record<string, "featured" | "good"> = { Q17437796: "featured", Q17437798: "good" };

type WikiPage = {
  title: string;
  missing?: boolean;
  invalid?: boolean;
  extract?: string;
  length?: number;
  links?: { ns: number; title: string }[];
  pageprops?: { wikibase_item?: string; disambiguation?: string };
  revisions?: { revid: number }[];
};
type QueryBody = {
  continue?: Record<string, string>;
  query?: {
    pages?: WikiPage[];
    backlinks?: { title: string }[];
    search?: { title: string }[];
  };
};

const realSleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

export function createWikimediaClient(
  fetchImpl: FetchLike = fetch,
  opts: { minGapMs?: number; sleep?: (ms: number) => Promise<void> } = {},
): WikimediaClient {
  const minGapMs = opts.minGapMs ?? DEFAULT_GAP_MS;
  const sleep = opts.sleep ?? realSleep;
  let nextSlot = 0;

  /** Reserves the next request slot, at least `minGapMs` after the previous one. */
  async function throttle(): Promise<void> {
    if (minGapMs <= 0) return;
    const now = Date.now();
    const slot = Math.max(now, nextSlot);
    nextSlot = slot + minGapMs;
    if (slot > now) await sleep(slot - now);
  }

  async function getJson(url: URL): Promise<unknown> {
    let response: Response | undefined;
    for (let attempt = 1; attempt <= MAX_TRIES; attempt++) {
      await throttle();
      try {
        response = await fetchImpl(url.toString(), {
          headers: { "User-Agent": USER_AGENT },
          signal: AbortSignal.timeout(TIMEOUT_MS),
        });
      } catch (err) {
        throw new WikipediaError("unreachable", `Couldn't reach ${url.host}.`, { cause: err });
      }
      if (response.status !== 429) break;
      if (attempt === MAX_TRIES) {
        throw new WikipediaError("unreachable", `${url.host} is rate-limiting; try again in a few minutes.`);
      }
      const seconds = Number(response.headers.get("Retry-After"));
      await sleep(Number.isFinite(seconds) && seconds > 0 ? seconds * 1000 : DEFAULT_RETRY_MS[attempt - 1]);
    }
    if (!response || !response.ok) {
      throw new WikipediaError("unreachable", `${url.host} answered ${response?.status}.`);
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

  const apiUrl = (ref: WikiRef, params: Record<string, string>) => {
    const url = new URL(`https://${wikiHost(ref)}/w/api.php`);
    url.search = new URLSearchParams({ action: "query", format: "json", formatversion: "2", ...params }).toString();
    return url;
  };
  const query = async (url: URL) => (await getJson(url)) as QueryBody;

  async function extract(ref: WikiRef, title: string): Promise<Article> {
    const language = new Intl.DisplayNames(["en"], { type: "language" }).of(ref.language) ?? ref.language;
    const site = ref.site[0].toUpperCase() + ref.site.slice(1);
    const notFound = new WikipediaError("not_found", `No ${language} ${site} article is titled "${title}".`);
    // `titles` splits on `|`, which is not a legal title character, so such a title never matches.
    if (title.includes("|")) throw notFound;
    const data = await query(
      apiUrl(ref, {
        redirects: "1",
        prop: "extracts|pageprops|revisions",
        explaintext: "1",
        exsectionformat: "wiki",
        rvprop: "ids",
        ppprop: "wikibase_item|disambiguation",
        titles: title,
      }),
    );
    const page = data.query?.pages?.[0];
    if (!page || page.missing || page.invalid) throw notFound;
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

  async function sitelinks(qid: string): Promise<Sitelink[]> {
    const url = new URL("https://www.wikidata.org/w/api.php");
    url.search = new URLSearchParams({ action: "wbgetentities", format: "json", ids: qid, props: "sitelinks" }).toString();
    const data = (await getJson(url)) as {
      entities?: Record<string, { sitelinks?: Record<string, { title: string; badges?: string[] }> }>;
    };
    const result: Sitelink[] = [];
    for (const [key, link] of Object.entries(data.entities?.[qid]?.sitelinks ?? {})) {
      const match = SITELINK_KEY.exec(key);
      if (!match || !LANGUAGE_CODE.test(match[1])) continue; // commonswiki, specieswiki, wikidatawiki…
      const site = match[2] ? SITE_BY_SUFFIX[match[2]] : "wikipedia";
      const badges = (link.badges ?? []).flatMap((b) => (BADGES[b] ? [BADGES[b]] : []));
      result.push({ site, language: match[1].replaceAll("_", "-"), title: link.title, badges });
    }
    return result;
  }

  async function links(ref: WikiRef, title: string): Promise<string[]> {
    const titles: string[] = [];
    let cont: string | undefined;
    do {
      const params: Record<string, string> = {
        redirects: "1",
        prop: "links",
        pllimit: "max",
        plnamespace: "0",
        titles: title,
      };
      if (cont) params.plcontinue = cont;
      const data = await query(apiUrl(ref, params));
      for (const link of data.query?.pages?.[0]?.links ?? []) if (link.ns === 0) titles.push(link.title);
      cont = data.continue?.plcontinue;
    } while (cont);
    return titles;
  }

  async function backlinks(ref: WikiRef, title: string, limit: number): Promise<string[]> {
    const titles: string[] = [];
    let cont: string | undefined;
    do {
      const params: Record<string, string> = {
        list: "backlinks",
        bltitle: title,
        blnamespace: "0",
        bllimit: String(Math.min(limit - titles.length, 500)),
      };
      if (cont) params.blcontinue = cont;
      const data = await query(apiUrl(ref, params));
      titles.push(...(data.query?.backlinks ?? []).map((b) => b.title));
      cont = data.continue?.blcontinue;
    } while (cont && titles.length < limit);
    return titles.slice(0, limit);
  }

  async function search(ref: WikiRef, phrase: string, limit: number): Promise<string[]> {
    const data = await query(
      apiUrl(ref, {
        list: "search",
        srsearch: `"${phrase.replaceAll('"', " ")}"`,
        srnamespace: "0",
        srlimit: String(Math.min(limit, 500)),
        srprop: "",
      }),
    );
    return (data.query?.search ?? []).map((s) => s.title).slice(0, limit);
  }

  async function pageLengths(ref: WikiRef, titles: string[]): Promise<Map<string, number>> {
    const lengths = new Map<string, number>();
    for (let i = 0; i < titles.length; i += TITLES_PER_REQUEST) {
      const batch = titles.slice(i, i + TITLES_PER_REQUEST);
      const data = await query(apiUrl(ref, { redirects: "1", prop: "info", titles: batch.join("|") }));
      for (const page of data.query?.pages ?? []) {
        if (!page.missing && !page.invalid && typeof page.length === "number") lengths.set(page.title, page.length);
      }
    }
    return lengths;
  }

  return { getJson, extract, sitelinks, links, backlinks, search, pageLengths };
}

export const wikimedia = createWikimediaClient();
