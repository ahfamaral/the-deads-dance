import type { Pool } from "pg";
import { deathYearNumber } from "../../corpus/lifespan";
import { findPersona } from "../../corpus/personas";
import type { HistoricalContextResult, Leader, WorldEvent } from "../../corpus/tool-results";

/**
 * get_historical_context (spec §4, §14.5): what was happening in the world in one year, and who
 * governed the persona's countries, from the Wikidata Query Service. Shares nothing with the
 * biography module but the persona lookup. Contemporaries were dropped: every query by
 * occupation timed out at 60 s on the public service.
 */

export const MAX_EVENTS = 8;
export const MAX_LABEL_LENGTH = 120;
/** Each query; the two run in parallel, well inside the 30 s MCP tool timeout. WDQS took 2–26 s in probes. */
export const SPARQL_TIMEOUT_MS = 12_000;

const ENDPOINT = "https://query.wikidata.org/sparql";
const USER_AGENT = "persona-chatbot/0.1 (Turing College student project)";

export type SparqlRow = Record<string, { value: string } | undefined>;
/** Runs one SELECT query and returns its bindings; throws on any failure. */
export type Sparql = (query: string) => Promise<SparqlRow[]>;

export type WorldDeps = { pool: Pool; sparql: Sparql };

type FetchLike = (url: string, init?: RequestInit) => Promise<Response>;

export function sparqlWith(fetchImpl: FetchLike = fetch, timeoutMs = SPARQL_TIMEOUT_MS): Sparql {
  return async (query) => {
    const url = new URL(ENDPOINT);
    url.search = new URLSearchParams({ query, format: "json" }).toString();
    const response = await fetchImpl(url.toString(), {
      headers: { "User-Agent": USER_AGENT, Accept: "application/sparql-results+json" },
      signal: AbortSignal.timeout(timeoutMs),
    });
    if (!response.ok) throw new Error(`${url.host} answered ${response.status}.`);
    const body = (await response.json()) as { results?: { bindings?: unknown } };
    const bindings = body.results?.bindings;
    if (!Array.isArray(bindings)) throw new Error(`${url.host} sent no results.`);
    return bindings as SparqlRow[];
  };
}

/** Spec §14.5: a per-year cache, so a WDQS outage can't break a demo twice. Failures aren't cached. */
export function cachedSparql(inner: Sparql): Sparql {
  const cache = new Map<string, SparqlRow[]>();
  return async (query) => {
    const hit = cache.get(query);
    if (hit) return hit;
    const rows = await inner(query);
    cache.set(query, rows);
    return rows;
  };
}

function isoYear(year: number): string {
  return `"${String(year).padStart(4, "0")}-01-01T00:00:00Z"^^xsd:dateTime`;
}

const LABELS = 'SERVICE wikibase:label { bd:serviceParam wikibase:language "en". }';

/**
 * Events dated in the year, ranked by how many Wikipedias cover them. Type filters made WDQS
 * 3–10x slower, so the year item itself ("1905") is dropped in code; two spare rows make up for it.
 */
export function eventsQuery(year: number): string {
  return `SELECT ?item ?itemLabel ?date ?links WHERE {
  ?item wdt:P585 ?date .
  FILTER(?date >= ${isoYear(year)} && ?date < ${isoYear(year + 1)})
  ?item wikibase:sitelinks ?links . FILTER(?links >= 25)
  ${LABELS}
} ORDER BY DESC(?links) LIMIT ${MAX_EVENTS + 2}`;
}

/** Heads of state (P1906) and government (P1313) of the persona's countries (P27) in office that year; humans only. */
export function leadersQuery(qid: string, year: number): string {
  return `SELECT DISTINCT ?countryLabel ?officeLabel ?personLabel WHERE {
  wd:${qid} wdt:P27 ?country .
  { ?country wdt:P1906 ?office } UNION { ?country wdt:P1313 ?office }
  ?person p:P39 ?held . ?held ps:P39 ?office ; pq:P580 ?start .
  ?person wdt:P31 wd:Q5 .
  OPTIONAL { ?held pq:P582 ?end }
  FILTER(?start < ${isoYear(year + 1)} && (!BOUND(?end) || ?end >= ${isoYear(year)}))
  ${LABELS}
}`;
}

// Spec §10 surface 3: Wikidata labels are third-party text on their way to the persona.
function asLabel(value: string | undefined): string | null {
  const text = (value ?? "").replace(/[<>]/g, "").trim().slice(0, MAX_LABEL_LENGTH);
  return text || null;
}

/** Rows to events: labelled, dated, unique, and not a bare year item like "1905". */
function toEvents(rows: SparqlRow[]): WorldEvent[] {
  const seen = new Set<string>();
  const events: WorldEvent[] = [];
  for (const row of rows) {
    const label = asLabel(row.itemLabel?.value);
    const date = row.date?.value.slice(0, 10);
    if (!label || !date || seen.has(label) || /^\d{1,4}( BC)?$/.test(label)) continue;
    seen.add(label);
    events.push({ label, date });
  }
  return events.slice(0, MAX_EVENTS);
}

function toLeaders(rows: SparqlRow[]): Leader[] {
  const seen = new Set<string>();
  const leaders: Leader[] = [];
  for (const row of rows) {
    const country = asLabel(row.countryLabel?.value);
    const office = asLabel(row.officeLabel?.value);
    const person = asLabel(row.personLabel?.value);
    const key = `${country}|${office}|${person}`;
    if (!country || !office || !person || seen.has(key)) continue;
    seen.add(key);
    leaders.push({ country, office, person });
  }
  return leaders;
}

async function settle(label: string, run: () => Promise<SparqlRow[]>): Promise<SparqlRow[] | null> {
  try {
    return await run();
  } catch (err) {
    console.error(`Wikidata ${label} query failed.`, err); // stderr: stdout carries the MCP protocol
    return null;
  }
}

export async function getHistoricalContext(
  deps: WorldDeps,
  input: { year: number; persona_id: string },
): Promise<HistoricalContextResult> {
  const { year } = input;
  const persona = await findPersona(deps.pool, input.persona_id);
  if (!persona || persona.status !== "ready") return { status: "unavailable", reason: `No ready persona "${input.persona_id}".` };
  const died = deathYearNumber(persona.lifespan);
  if (died !== null && year > died) return { status: "empty", year, reason: "That year came after your death." };

  // The id is spliced into SPARQL text, so only a plain Q-id is ever used.
  const qid = persona.wikidataQid && /^Q\d+$/.test(persona.wikidataQid) ? persona.wikidataQid : null;
  const [eventRows, leaderRows] = await Promise.all([
    settle("events", () => deps.sparql(eventsQuery(year))),
    qid ? settle("leaders", () => deps.sparql(leadersQuery(qid, year))) : Promise.resolve(null),
  ]);
  // Unavailable when nothing that ran succeeded; a persona with no id only runs the events query.
  if (eventRows === null && leaderRows === null) {
    return { status: "unavailable", reason: "Wikidata can't be reached right now. Try again later." };
  }
  const events = toEvents(eventRows ?? []);
  const leaders = toLeaders(leaderRows ?? []);
  if (events.length === 0 && leaders.length === 0) return { status: "empty", year, reason: "Nothing recorded for that year." };
  return { status: "ok", year, events, leaders };
}
