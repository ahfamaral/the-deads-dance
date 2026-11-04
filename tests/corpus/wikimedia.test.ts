import { describe, expect, it, vi } from "vitest";
import { createWikimediaClient, wikiHost } from "../../corpus/wikimedia";
import { WikipediaError } from "../../corpus/wikipedia";

const json = (payload: unknown, init: ResponseInit = {}) => new Response(JSON.stringify(payload), init);
const setup = (...bodies: (unknown | Response)[]) => {
  const queue = [...bodies];
  const fetchImpl = vi.fn(async (_url: string, _init?: RequestInit) => {
    const next = queue.length > 1 ? queue.shift() : queue[0];
    return next instanceof Response ? next.clone() : json(next);
  });
  const sleeps: number[] = [];
  const client = createWikimediaClient(fetchImpl, {
    minGapMs: 200,
    sleep: async (ms) => {
      sleeps.push(ms);
    },
  });
  return { client, fetchImpl, sleeps };
};
const urlOf = (fetchImpl: ReturnType<typeof setup>["fetchImpl"], n = 0) => new URL(fetchImpl.mock.calls[n][0]);

const pt = { site: "wikipedia", language: "pt" } as const;

describe("wikiHost", () => {
  it("joins language and site", () => {
    expect(wikiHost(pt)).toBe("pt.wikipedia.org");
    expect(wikiHost({ site: "wikiquote", language: "fr" })).toBe("fr.wikiquote.org");
  });
});

describe("extract", () => {
  const page = {
    query: {
      pages: [
        { title: "Santos Dumont", extract: "Texto.", pageprops: { wikibase_item: "Q313211" }, revisions: [{ revid: 7 }] },
      ],
    },
  };

  it("asks the language's host with the article parameters and maps the page", async () => {
    const { client, fetchImpl } = setup(page);
    expect(await client.extract(pt, "Santos Dumont")).toEqual({
      title: "Santos Dumont",
      revid: 7,
      qid: "Q313211",
      text: "Texto.",
    });
    const url = urlOf(fetchImpl);
    expect(url.origin + url.pathname).toBe("https://pt.wikipedia.org/w/api.php");
    expect(Object.fromEntries(url.searchParams)).toMatchObject({
      action: "query",
      redirects: "1",
      prop: "extracts|pageprops|revisions",
      explaintext: "1",
      exsectionformat: "wiki",
      titles: "Santos Dumont",
    });
  });

  it("reports a missing page as not_found", async () => {
    const { client } = setup({ query: { pages: [{ title: "X", missing: true }] } });
    await expect(client.extract(pt, "X")).rejects.toMatchObject({ code: "not_found" });
  });
});

describe("sitelinks", () => {
  it("keeps Wikipedia, Wikiquote and Wikisource editions with badges and ignores other projects", async () => {
    const { client, fetchImpl } = setup({
      entities: {
        Q313211: {
          sitelinks: {
            ptwiki: { site: "ptwiki", title: "Santos Dumont", badges: ["Q17437798"] },
            ptwikiquote: { site: "ptwikiquote", title: "Alberto Santos-Dumont", badges: [] },
            frwikisource: { site: "frwikisource", title: "Auteur:Alberto Santos-Dumont", badges: [] },
            commonswiki: { site: "commonswiki", title: "Category:X", badges: [] },
            specieswiki: { site: "specieswiki", title: "X", badges: [] },
            wikidatawiki: { site: "wikidatawiki", title: "Q313211", badges: [] },
          },
        },
      },
    });
    expect(await client.sitelinks("Q313211")).toEqual([
      { site: "wikipedia", language: "pt", title: "Santos Dumont", badges: ["good"] },
      { site: "wikiquote", language: "pt", title: "Alberto Santos-Dumont", badges: [] },
      { site: "wikisource", language: "fr", title: "Auteur:Alberto Santos-Dumont", badges: [] },
    ]);
    const url = urlOf(fetchImpl);
    expect(url.host).toBe("www.wikidata.org");
    expect(url.searchParams.get("props")).toBe("sitelinks");
  });

  it("maps the featured badge", async () => {
    const { client } = setup({
      entities: { Q1: { sitelinks: { enwiki: { site: "enwiki", title: "A", badges: ["Q17437796"] } } } },
    });
    expect((await client.sitelinks("Q1"))[0].badges).toEqual(["featured"]);
  });
});

describe("links, backlinks and search", () => {
  it("links follows plcontinue and keeps namespace 0 only", async () => {
    const { client, fetchImpl } = setup(
      { continue: { plcontinue: "abc|0|X" }, query: { pages: [{ links: [{ ns: 0, title: "A" }, { ns: 14, title: "Category:B" }] }] } },
      { query: { pages: [{ links: [{ ns: 0, title: "C" }] }] } },
    );
    expect(await client.links(pt, "Page")).toEqual(["A", "C"]);
    expect(fetchImpl).toHaveBeenCalledTimes(2);
    expect(urlOf(fetchImpl, 1).searchParams.get("plcontinue")).toBe("abc|0|X");
    expect(urlOf(fetchImpl, 0).searchParams.get("plnamespace")).toBe("0");
  });

  it("backlinks honours the limit", async () => {
    const { client, fetchImpl } = setup({
      query: { backlinks: [{ title: "A" }, { title: "B" }, { title: "C" }] },
    });
    expect(await client.backlinks(pt, "Page", 2)).toEqual(["A", "B"]);
    const params = urlOf(fetchImpl).searchParams;
    expect(params.get("bltitle")).toBe("Page");
    expect(params.get("bllimit")).toBe("2");
  });

  it("search quotes the phrase and honours the limit", async () => {
    const { client, fetchImpl } = setup({ query: { search: [{ title: "A" }, { title: "B" }, { title: "C" }] } });
    expect(await client.search(pt, "Santos Dumont", 2)).toEqual(["A", "B"]);
    const params = urlOf(fetchImpl).searchParams;
    expect(params.get("srsearch")).toBe('"Santos Dumont"');
    expect(params.get("srlimit")).toBe("2");
  });
});

describe("pageLengths", () => {
  it("batches 120 titles into 3 requests of at most 50", async () => {
    const { client, fetchImpl } = setup({ query: { pages: [{ title: "T0", length: 10 }] } });
    const titles = Array.from({ length: 120 }, (_, i) => `T${i}`);
    const result = await client.pageLengths(pt, titles);
    expect(fetchImpl).toHaveBeenCalledTimes(3);
    const sizes = [0, 1, 2].map((n) => urlOf(fetchImpl, n).searchParams.get("titles")!.split("|").length);
    expect(sizes).toEqual([50, 50, 20]);
    expect(result.get("T0")).toBe(10);
  });

  it("keys the map by the requested titles, through normalisation and redirects", async () => {
    const { client } = setup({
      query: {
        normalized: [{ from: "santos dumont", to: "Santos dumont" }],
        redirects: [{ from: "Santos dumont", to: "Alberto Santos-Dumont" }, { from: "14-bis", to: "14-bis (avião)" }],
        pages: [
          { title: "Alberto Santos-Dumont", length: 900 },
          { title: "14-bis (avião)", length: 300 },
          { title: "Nada", missing: true },
        ],
      },
    });
    const result = await client.pageLengths(pt, ["santos dumont", "14-bis", "Nada"]);
    expect(Object.fromEntries(result)).toEqual({ "santos dumont": 900, "14-bis": 300 });
  });
});

describe("throttling and rate limits", () => {
  const ok = { query: { search: [] } };

  it("waits at least the gap between two calls in a row", async () => {
    const { client, sleeps } = setup(ok);
    await client.search(pt, "a", 1);
    expect(sleeps).toEqual([]);
    await client.search(pt, "b", 1);
    expect(sleeps).toHaveLength(1);
    expect(sleeps[0]).toBeGreaterThan(150);
    expect(sleeps[0]).toBeLessThanOrEqual(200);
  });

  it("waits Retry-After seconds on a 429 and then succeeds", async () => {
    const { client, sleeps } = setup(json({}, { status: 429, headers: { "Retry-After": "3" } }), ok);
    await expect(client.search(pt, "a", 1)).resolves.toEqual([]);
    expect(sleeps).toContain(3000);
  });

  it("gives up after three 429s", async () => {
    const { client, fetchImpl, sleeps } = setup(json({}, { status: 429 }));
    const err = await client.search(pt, "a", 1).catch((e) => e);
    expect(err).toBeInstanceOf(WikipediaError);
    expect(err).toMatchObject({ code: "unreachable" });
    expect(err.message).toContain("rate-limiting");
    expect(fetchImpl).toHaveBeenCalledTimes(3);
    expect(sleeps.filter((ms) => ms >= 1000)).toEqual([2000, 4000]); // the rest are throttle gaps
  });
});
