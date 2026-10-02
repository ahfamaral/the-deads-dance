import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import { closePool, getPool } from "../../corpus/db";
import {
  cachedSparql,
  eventsQuery,
  getHistoricalContext,
  leadersQuery,
  MAX_EVENTS,
  MAX_LABEL_LENGTH,
  sparqlWith,
  type Sparql,
  type SparqlRow,
} from "../../mcp-server/world/historical-context";
import { insertPersona, resetDb } from "../helpers/db";

const lit = (value: string) => ({ value });
const event = (label: string, date: string): SparqlRow => ({ itemLabel: lit(label), date: lit(`${date}T00:00:00Z`) });
const leader = (country: string, office: string, person: string): SparqlRow => ({
  countryLabel: lit(country),
  officeLabel: lit(office),
  personLabel: lit(person),
});

const EVENTS_1905 = [event("Russian Revolution of 1905", "1905-01-22"), event("Battle of Tsushima", "1905-05-28")];
const LEADERS_1905 = [leader("German Empire", "King of Prussia", "Wilhelm II"), leader("United States", "President of the United States", "Theodore Roosevelt")];

/** Answers the events query and the leaders query by what they ask for, like the real service would. */
function fakeSparql(events: SparqlRow[] = EVENTS_1905, leaders: SparqlRow[] = LEADERS_1905) {
  return vi.fn<Sparql>(async (query) => (query.includes("wdt:P585") ? events : leaders));
}

async function seedEinstein(): Promise<void> {
  await insertPersona({ slug: "einstein", lifespan: "1879–1955", wikidataQid: "Q937" });
}

beforeEach(() => resetDb());
afterAll(() => closePool());

describe("getHistoricalContext", () => {
  it("returns the year's events and who held power in the persona's countries", async () => {
    await seedEinstein();
    const result = await getHistoricalContext({ pool: getPool(), sparql: fakeSparql() }, { year: 1905, persona_id: "einstein" });
    expect(result).toEqual({
      status: "ok",
      year: 1905,
      events: [
        { label: "Russian Revolution of 1905", date: "1905-01-22" },
        { label: "Battle of Tsushima", date: "1905-05-28" },
      ],
      leaders: [
        { country: "German Empire", office: "King of Prussia", person: "Wilhelm II" },
        { country: "United States", office: "President of the United States", person: "Theodore Roosevelt" },
      ],
    });
  });

  // Spec §17.2: the persona knows nothing of what happened after its death.
  it("is empty for a year after the persona's death, without asking Wikidata", async () => {
    await seedEinstein();
    const sparql = fakeSparql();
    const result = await getHistoricalContext({ pool: getPool(), sparql }, { year: 1969, persona_id: "einstein" });
    expect(result).toEqual({ status: "empty", year: 1969, reason: "That year came after your death." });
    expect(sparql).not.toHaveBeenCalled();
  });

  it("is empty when Wikidata has nothing for the year", async () => {
    await seedEinstein();
    const result = await getHistoricalContext({ pool: getPool(), sparql: fakeSparql([], []) }, { year: 1880, persona_id: "einstein" });
    expect(result).toEqual({ status: "empty", year: 1880, reason: "Nothing recorded for that year." });
  });

  it("skips the leaders query for a persona with no Wikidata id", async () => {
    await insertPersona({ slug: "einstein", lifespan: "1879–1955", wikidataQid: null });
    const sparql = fakeSparql();
    const result = await getHistoricalContext({ pool: getPool(), sparql }, { year: 1905, persona_id: "einstein" });
    expect(result).toMatchObject({ status: "ok", leaders: [] });
    expect(sparql).toHaveBeenCalledTimes(1);
  });

  // The Wikidata id goes into SPARQL text, so anything that isn't a plain Q-id is never used.
  it("never puts a malformed Wikidata id into the query", async () => {
    await insertPersona({ slug: "einstein", lifespan: "1879–1955", wikidataQid: "Q937 } UNION { ?x ?y ?z" });
    const sparql = fakeSparql();
    await getHistoricalContext({ pool: getPool(), sparql }, { year: 1905, persona_id: "einstein" });
    expect(sparql).toHaveBeenCalledTimes(1);
    expect(sparql.mock.calls[0][0]).not.toContain("UNION { ?x");
  });

  it("keeps what one query found when the other fails", async () => {
    await seedEinstein();
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    const sparql = vi.fn<Sparql>(async (query) => {
      if (query.includes("wdt:P585")) return EVENTS_1905;
      throw new Error("query.wikidata.org answered 429.");
    });
    const result = await getHistoricalContext({ pool: getPool(), sparql }, { year: 1905, persona_id: "einstein" });
    expect(result).toMatchObject({ status: "ok", events: [{ label: "Russian Revolution of 1905" }, { label: "Battle of Tsushima" }], leaders: [] });
    error.mockRestore();
  });

  it("is unavailable when both queries fail", async () => {
    await seedEinstein();
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    const sparql = vi.fn<Sparql>(async () => {
      throw new Error("query.wikidata.org answered 429.");
    });
    const result = await getHistoricalContext({ pool: getPool(), sparql }, { year: 1905, persona_id: "einstein" });
    expect(result).toEqual({ status: "unavailable", reason: "Wikidata can't be reached right now. Try again later." });
    error.mockRestore();
  });

  it("is unavailable when the only query it runs fails", async () => {
    await insertPersona({ slug: "einstein", lifespan: "1879–1955", wikidataQid: null });
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    const sparql = vi.fn<Sparql>(async () => {
      throw new Error("query.wikidata.org answered 502.");
    });
    const result = await getHistoricalContext({ pool: getPool(), sparql }, { year: 1905, persona_id: "einstein" });
    expect(result).toMatchObject({ status: "unavailable" });
    error.mockRestore();
  });

  it("is unavailable for an unknown persona", async () => {
    const result = await getHistoricalContext({ pool: getPool(), sparql: fakeSparql() }, { year: 1905, persona_id: "nobody" });
    expect(result).toMatchObject({ status: "unavailable" });
  });

  // Spec §10 surface 3: Wikidata labels are third-party text that reaches the persona.
  it("strips angle brackets, caps labels, drops duplicates and blanks, and caps the events", async () => {
    await seedEinstein();
    const many = Array.from({ length: MAX_EVENTS + 4 }, (_, i) => event(`Event ${i}`, "1905-03-01"));
    const events = [
      event("<b>Bloody Sunday</b>", "1905-01-22"),
      event("<b>Bloody Sunday</b>", "1905-01-22"),
      event("  ", "1905-02-01"),
      event("x".repeat(MAX_LABEL_LENGTH + 40), "1905-02-02"),
      ...many,
    ];
    const result = await getHistoricalContext({ pool: getPool(), sparql: fakeSparql(events, []) }, { year: 1905, persona_id: "einstein" });
    if (result.status !== "ok") throw new Error(`expected ok, got ${result.status}`);
    expect(result.events).toHaveLength(MAX_EVENTS);
    expect(result.events[0]).toEqual({ label: "bBloody Sunday/b", date: "1905-01-22" });
    expect(result.events[1].label).toHaveLength(MAX_LABEL_LENGTH);
  });

  it("drops the year item itself", async () => {
    await seedEinstein();
    const result = await getHistoricalContext(
      { pool: getPool(), sparql: fakeSparql([event("1905", "1905-01-01"), ...EVENTS_1905], []) },
      { year: 1905, persona_id: "einstein" },
    );
    expect(result).toMatchObject({ status: "ok", events: [{ label: "Russian Revolution of 1905" }, { label: "Battle of Tsushima" }] });
  });

  it("ignores rows with missing fields", async () => {
    await seedEinstein();
    const result = await getHistoricalContext(
      { pool: getPool(), sparql: fakeSparql([{ itemLabel: lit("No date") }, ...EVENTS_1905], [{ personLabel: lit("Nobody") }]) },
      { year: 1905, persona_id: "einstein" },
    );
    expect(result).toMatchObject({ status: "ok", events: [{ label: "Russian Revolution of 1905" }, { label: "Battle of Tsushima" }], leaders: [] });
  });
});

describe("SPARQL queries", () => {
  // Live probing: type filters made WDQS 3-10x slower, so year items are dropped in code instead.
  it("asks for dated events in the year, most covered first, with room for dropped year items", () => {
    const q = eventsQuery(1905);
    expect(q).toContain('"1905-01-01T00:00:00Z"^^xsd:dateTime');
    expect(q).toContain('"1906-01-01T00:00:00Z"^^xsd:dateTime');
    expect(q).toContain("wdt:P585");
    expect(q).not.toContain("FILTER NOT EXISTS");
    expect(q).toContain(`ORDER BY DESC(?links) LIMIT ${MAX_EVENTS + 2}`);
  });

  it("pads early years to four digits", () => {
    expect(eventsQuery(476)).toContain('"0476-01-01T00:00:00Z"^^xsd:dateTime');
  });

  it("asks for real people holding their country's top offices that year", () => {
    const q = leadersQuery("Q937", 1905);
    expect(q).toContain("wd:Q937 wdt:P27 ?country");
    expect(q).toContain("wdt:P1906");
    expect(q).toContain("wdt:P1313");
    expect(q).toContain("?person wdt:P31 wd:Q5");
  });
});

describe("sparqlWith", () => {
  it("sends the query with a User-Agent and returns the bindings", async () => {
    const fetchImpl = vi.fn(async () => Response.json({ results: { bindings: EVENTS_1905 } }));
    expect(await sparqlWith(fetchImpl)("SELECT 1")).toEqual(EVENTS_1905);
    const [url, init] = fetchImpl.mock.calls[0] as unknown as [string, RequestInit];
    expect(new URL(url).searchParams.get("query")).toBe("SELECT 1");
    expect((init.headers as Record<string, string>)["User-Agent"]).toMatch(/persona-chatbot/);
    expect(init.signal).toBeInstanceOf(AbortSignal);
  });

  it.each([
    ["an HTTP error", async () => new Response("slow down", { status: 429 })],
    ["a body that isn't JSON", async () => new Response("<html>", { status: 200 })],
    ["a body without bindings", async () => Response.json({ head: {} })],
    [
      "a network failure",
      async () => {
        throw new TypeError("fetch failed");
      },
    ],
  ])("throws on %s", async (_label, fetchImpl) => {
    await expect(sparqlWith(fetchImpl)("SELECT 1")).rejects.toThrow();
  });
});

describe("cachedSparql", () => {
  it("answers a repeated query from the cache", async () => {
    const inner = vi.fn<Sparql>(async () => EVENTS_1905);
    const sparql = cachedSparql(inner);
    await sparql("A");
    expect(await sparql("A")).toEqual(EVENTS_1905);
    await sparql("B");
    expect(inner).toHaveBeenCalledTimes(2);
  });

  it("doesn't cache a failure", async () => {
    const inner = vi.fn<Sparql>().mockRejectedValueOnce(new Error("429")).mockResolvedValueOnce(EVENTS_1905);
    const sparql = cachedSparql(inner);
    await expect(sparql("A")).rejects.toThrow("429");
    expect(await sparql("A")).toEqual(EVENTS_1905);
  });
});
