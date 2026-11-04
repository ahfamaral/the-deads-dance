import { normalizeLanguages, type PersonaLanguage } from "./languages";

import { createWikimediaClient, type Article, type FetchLike } from "./wikimedia";

export { WikipediaError, type Article, type FetchLike, type WikipediaErrorCode } from "./wikimedia";
export type PersonFacts = { isHuman: boolean; isDeceased: boolean; description: string; lifespan: string };

export const MAX_DESCRIPTION_LENGTH = 100;
const HUMAN = "Q5";

/** No spacing between calls: these single lookups each build their own client. */
const clientFor = (fetchImpl: FetchLike) => createWikimediaClient(fetchImpl, { minGapMs: 0 });

export function fetchArticle(title: string, fetchImpl: FetchLike = fetch): Promise<Article> {
  return clientFor(fetchImpl).extract({ site: "wikipedia", language: "en" }, title);
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

  const data = (await clientFor(fetchImpl).getJson(url)) as { entities?: Record<string, WikidataEntity> };
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
  const person = (await clientFor(fetchImpl).getJson(personUrl)) as { entities?: Record<string, LanguageEntity> };
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
  const items = (await clientFor(fetchImpl).getJson(itemsUrl)) as { entities?: Record<string, LanguageEntity> };

  const languages = ids.flatMap((id): PersonaLanguage[] => {
    const entity = items.entities?.[id];
    const code = entity?.claims?.P218?.[0]?.mainsnak?.datavalue?.value;
    const name = entity?.labels?.en?.value?.trim();
    if (typeof code !== "string" || !/^[a-z]{2}$/.test(code) || !name) return [];
    return [{ code, name: name.slice(0, 40), native: native.has(id) }];
  });
  return normalizeLanguages(languages);
}
