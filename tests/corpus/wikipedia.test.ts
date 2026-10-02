import { describe, expect, it, vi } from "vitest";
import { fetchArticle, fetchPersonFacts, fetchPersonLanguages, formatLifespan, WikipediaError } from "../../corpus/wikipedia";

const respond = (payload: unknown, status = 200) =>
  vi.fn(async () => new Response(JSON.stringify(payload), { status }));

const wuPage = {
  query: {
    pages: [
      {
        pageid: 252131,
        ns: 0,
        title: "Chien-Shiung Wu",
        extract: "Chien-Shiung Wu was a physicist.\n\n== Early life ==\nBorn in Liuhe.",
        pageprops: { wikibase_item: "Q450317" },
        revisions: [{ revid: 1374160316, parentid: 1374157846 }],
      },
    ],
  },
};

describe("fetchArticle", () => {
  it("maps title, revision, QID and text", async () => {
    const result = await fetchArticle("Chien-Shiung_Wu", respond(wuPage));
    expect(result).toEqual({
      title: "Chien-Shiung Wu",
      revid: 1374160316,
      qid: "Q450317",
      text: "Chien-Shiung Wu was a physicist.\n\n== Early life ==\nBorn in Liuhe.",
    });
  });

  it("follows redirects, asks for plain text with wiki headings, and sends a User-Agent", async () => {
    const fetchImpl = respond(wuPage);
    await fetchArticle("Wu", fetchImpl);
    const [url, init] = fetchImpl.mock.calls[0] as unknown as [string, RequestInit];
    const params = new URL(url).searchParams;
    expect(params.get("redirects")).toBe("1");
    expect(params.get("explaintext")).toBe("1");
    expect(params.get("exsectionformat")).toBe("wiki");
    expect(params.get("titles")).toBe("Wu");
    expect((init.headers as Record<string, string>)["User-Agent"]).toMatch(/persona-chatbot/);
  });

  it("rejects a missing page", async () => {
    const missing = { query: { pages: [{ ns: 0, title: "Nope", missing: true }] } };
    await expect(fetchArticle("Nope", respond(missing))).rejects.toMatchObject({ code: "not_found" });
  });

  it("rejects a disambiguation page", async () => {
    const disambig = { query: { pages: [{ pageid: 19007, ns: 0, title: "Mercury", pageprops: { disambiguation: "" } }] } };
    await expect(fetchArticle("Mercury", respond(disambig))).rejects.toMatchObject({ code: "disambiguation" });
  });

  it("reports network failure and HTTP errors as unreachable", async () => {
    const down = vi.fn(async () => {
      throw new TypeError("fetch failed");
    });
    await expect(fetchArticle("Wu", down)).rejects.toBeInstanceOf(WikipediaError);
    await expect(fetchArticle("Wu", down)).rejects.toMatchObject({ code: "unreachable" });
    await expect(fetchArticle("Wu", respond({}, 503))).rejects.toMatchObject({ code: "unreachable" });
  });

  it("rejects a non-JSON response as unreachable", async () => {
    const htmlResponse = vi.fn(async () => new Response("<html>login</html>", { status: 200 }));
    await expect(fetchArticle("Wu", htmlResponse)).rejects.toMatchObject({ code: "unreachable" });
  });

  it("rejects an HTTP-200 API error body as unreachable", async () => {
    await expect(fetchArticle("Wu", respond({ error: { code: "readonly" } }))).rejects.toMatchObject({
      code: "unreachable",
    });
  });

  it("rejects a JSON null body as unreachable", async () => {
    const nullResponse = vi.fn(async () => new Response("null", { status: 200 }));
    await expect(fetchArticle("Wu", nullResponse)).rejects.toMatchObject({ code: "unreachable" });
  });

  it("preserves the original fetch error as `cause`", async () => {
    const boom = new TypeError("fetch failed");
    const down = vi.fn(async () => {
      throw boom;
    });
    await expect(fetchArticle("Wu", down)).rejects.toMatchObject({ cause: boom });
  });

  it("rejects a title containing `|` without calling fetch", async () => {
    const stub = vi.fn();
    await expect(fetchArticle("Albert Einstein|Isaac Newton", stub)).rejects.toMatchObject({ code: "not_found" });
    expect(stub).not.toHaveBeenCalled();
  });
});

const entity = (claims: Record<string, unknown[]>, description = "Chinese-American physicist") => ({
  entities: { Q450317: { id: "Q450317", descriptions: { en: { language: "en", value: description } }, claims } },
});
const instanceOf = (id: string) => ({ mainsnak: { datavalue: { value: { id } } } });
const date = (time: string, precision = 11) => ({ mainsnak: { datavalue: { value: { time, precision } } } });

describe("fetchPersonFacts", () => {
  it("recognises a human and formats the lifespan", async () => {
    const payload = entity({
      P31: [instanceOf("Q5")],
      P569: [date("+1912-05-31T00:00:00Z")],
      P570: [date("+1997-02-16T00:00:00Z")],
    });
    expect(await fetchPersonFacts("Q450317", respond(payload))).toEqual({
      isHuman: true,
      isDeceased: true,
      description: "Chinese-American physicist",
      lifespan: "1912–1997",
    });
  });

  it("counts a death recorded as 'unknown value' as deceased", async () => {
    const payload = entity({
      P31: [instanceOf("Q5")],
      P569: [date("+1500-01-01T00:00:00Z", 9)],
      P570: [{ mainsnak: { snaktype: "somevalue" } }],
    });
    expect(await fetchPersonFacts("Q450317", respond(payload))).toMatchObject({ isDeceased: true, lifespan: "born 1500" });
  });

  it("flags a non-human item", async () => {
    const payload = entity({ P31: [instanceOf("Q11173")] }, "chemical compound");
    expect((await fetchPersonFacts("Q450317", respond(payload))).isHuman).toBe(false);
  });

  // Review Focus 3: living people and BC dates.
  it("handles a living person and BC years", async () => {
    const living = entity({ P31: [instanceOf("Q5")], P569: [date("+1950-01-01T00:00:00Z")] });
    expect((await fetchPersonFacts("Q450317", respond(living))).lifespan).toBe("born 1950");
    expect((await fetchPersonFacts("Q450317", respond(living))).isDeceased).toBe(false);

    const ancient = entity({
      P31: [instanceOf("Q5")],
      P569: [date("-0470-00-00T00:00:00Z", 9)],
      P570: [date("-0399-00-00T00:00:00Z", 9)],
    });
    expect((await fetchPersonFacts("Q450317", respond(ancient))).lifespan).toBe("470 BC–399 BC");
  });

  it("ignores dates less precise than a year", async () => {
    const vague = entity({ P31: [instanceOf("Q5")], P569: [date("+1800-00-00T00:00:00Z", 7)] });
    expect((await fetchPersonFacts("Q450317", respond(vague))).lifespan).toBe("");
  });

  it("caps the description at 100 characters", async () => {
    const payload = entity({ P31: [instanceOf("Q5")] }, "x".repeat(300));
    expect((await fetchPersonFacts("Q450317", respond(payload))).description).toHaveLength(100);
  });

  it("rejects an HTTP-200 API error body as unreachable", async () => {
    await expect(fetchPersonFacts("Q450317", respond({ error: { code: "readonly" } }))).rejects.toMatchObject({
      code: "unreachable",
    });
  });
});

describe("formatLifespan", () => {
  it("covers the four combinations", () => {
    expect(formatLifespan("1912", "1997")).toBe("1912–1997");
    expect(formatLifespan("1950", null)).toBe("born 1950");
    expect(formatLifespan(null, "1943")).toBe("died 1943");
    expect(formatLifespan(null, null)).toBe("");
  });
});

describe("fetchPersonLanguages", () => {
  const itemRef = (id: string) => ({ mainsnak: { datavalue: { value: { id } } } });
  const iso = (code: string) => ({ mainsnak: { datavalue: { value: code } } });
  const person = { entities: { Q937: { claims: { P103: [itemRef("Q188")], P1412: [itemRef("Q1860"), itemRef("Q188"), itemRef("Q999")] } } } };
  const languageItems = {
    entities: {
      Q188: { labels: { en: { value: "German" } }, claims: { P218: [iso("de")] } },
      Q1860: { labels: { en: { value: "English" } }, claims: { P218: [iso("en")] } },
      Q999: { labels: { en: { value: "Old Lingo" } }, claims: {} },
    },
  };

  it("reads native and spoken languages, resolving codes and dropping items without one", async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(new Response(JSON.stringify(person)))
      .mockResolvedValueOnce(new Response(JSON.stringify(languageItems)));
    expect(await fetchPersonLanguages("Q937", fetchImpl)).toEqual([
      { code: "de", name: "German", native: true },
      { code: "en", name: "English", native: false },
    ]);
    const second = new URL(fetchImpl.mock.calls[1][0] as string);
    expect(second.searchParams.get("ids")?.split("|").sort()).toEqual(["Q1860", "Q188", "Q999"]);
  });

  it("returns an empty list without a second request when none are recorded", async () => {
    const fetchImpl = respond({ entities: { Q1: { claims: {} } } });
    expect(await fetchPersonLanguages("Q1", fetchImpl)).toEqual([]);
    expect(fetchImpl).toHaveBeenCalledOnce();
  });

  it("throws a WikipediaError when Wikidata is unreachable", async () => {
    await expect(fetchPersonLanguages("Q1", respond({}, 503))).rejects.toBeInstanceOf(WikipediaError);
  });
});
