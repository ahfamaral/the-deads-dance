import type { Pool } from "pg";
import { AddPersonaError, prepareUserPersona, type AddPersonaErrorCode, type PrepareDeps } from "@corpus/add-persona";
import { meteredEmbeddings, type CostLedger } from "@corpus/cost-ledger";
import { describeDbError, getPool } from "@corpus/db";
import { editionScorer, type ScoreFn } from "@corpus/editions";
import { EMBEDDING_MODEL, EmbeddingDimensionError, embeddingModel } from "@corpus/embeddings";
import { comparisonEstimate, embeddingEstimate, type Price } from "@corpus/estimate";
import { listLinked, listMentions, listQuotes, listWritings, type Candidate } from "@corpus/extras";
import { highlightsDrafter } from "@corpus/highlights";
import { IngestError, type PersonaEntry } from "@corpus/ingest";
import { FALLBACK_LANGUAGES, type PersonaLanguage } from "@corpus/languages";
import { modelId } from "@corpus/models";
import { findPersona, type PersonaRow } from "@corpus/personas";
import { profileGenerator } from "@corpus/profile";
import { RoundError, type RoundDeps, type RoundErrorCode, type RoundTarget } from "@corpus/reingest";
import { listRounds, listSources, setItemCost, STALE_INGEST_MINUTES, type Round, type SourceKind } from "@corpus/rounds";
import { wikimedia, WikipediaError, type Article, type WikimediaClient } from "@corpus/wikimedia";
import { fetchPersonFacts, fetchPersonLanguages } from "@corpus/wikipedia";
import {
  CANDIDATE_PAGE, HIGHLIGHTS_EDIT_MAX,
  type CandidatesResult, type LanguageSource, type PersonaProfileDto, type ProfileLanguage, type RoundDto, type RoundEvent,
} from "@/lib/persona-profile";
import { NO_VOICE, toPersona } from "@/lib/personas";
import { unavailable } from "@/lib/server/access";
import { listFeedback } from "@/lib/server/feedback";
import { priceOf, resolveCosts } from "@/lib/server/pricing";
import { recordCalls } from "@/lib/server/spend";

/**
 * Spec §34.3–§34.6: the server side of the admin persona pages: the profile loader, the
 * highlights edit, the real dependencies of the free lookups and of a round, and the error
 * mapping the routes share. Route tests replace `adminDeps` and `roundDeps`.
 */

type Queryable = Pick<Pool, "query">;

/** Spec §34.2: a running round older than the stale limit counts as failed. */
export function isStaleRound(round: Round, now = Date.now()): boolean {
  return round.status === "running" && now - round.startedAt.getTime() > STALE_INGEST_MINUTES * 60_000;
}

const LANGUAGE_SOURCES: Record<string, LanguageSource> = { wikidata: "Wikidata", curated: "set by hand", fallback: "none found, English assumed" };

/** Spec §34.4: each language with where it came from; English assumed when none is stored. */
function profileLanguages(persona: PersonaRow, stored: string | null): ProfileLanguage[] {
  const known = persona.storedLanguages;
  if (!known || known.length === 0) return FALLBACK_LANGUAGES.map((l) => ({ ...l, source: "none found, English assumed" }));
  const source = LANGUAGE_SOURCES[stored ?? ""] ?? (persona.origin === "curated" ? "set by hand" : "Wikidata");
  return known.map((l) => ({ ...l, source }));
}

const ROUND_NOTES: Partial<Record<Round["status"], string>> = { draft: "Compared, not ingested", running: "Reingest running" };

function toRoundDto(round: Round, now: number): RoundDto {
  const status = isStaleRound(round, now) ? "failed" : round.status;
  const costs = round.items.flatMap((i) => (i.cost === null ? [] : [i.cost]));
  return {
    id: round.id,
    number: round.number,
    status,
    note: ROUND_NOTES[status] ?? null,
    startedAt: round.startedAt.toISOString(),
    finishedAt: round.finishedAt?.toISOString() ?? null,
    cost: costs.length ? costs.reduce((a, b) => a + b, 0) : null,
    items: round.items,
  };
}

/** Spec §34.4: everything the profile page shows, or null for an unknown slug. */
export async function loadPersonaProfile(db: Pool, slug: string): Promise<PersonaProfileDto | null> {
  const persona = await findPersona(db, slug);
  if (!persona) return null;
  const [extra, sources, rounds, ratings] = await Promise.all([
    db.query<{ highlights: string | null; languages_source: string | null }>(
      `SELECT highlights, languages_source FROM personas WHERE id = $1`,
      [persona.id],
    ),
    listSources(db, persona.id),
    listRounds(db, slug),
    listFeedback(db, slug),
  ]);
  const now = Date.now();
  const roundDtos = rounds.map((r) => toRoundDto(r, now));
  const compared = rounds.find((r) => r.comparison !== null);
  return {
    slug: persona.slug,
    name: persona.displayName,
    description: persona.description,
    lifespan: persona.lifespan,
    origin: persona.origin,
    highlights: extra.rows[0]?.highlights ?? null,
    profile: persona.profile,
    languages: profileLanguages(persona, extra.rows[0]?.languages_source ?? null),
    sources: sources.map((s) => ({ kind: s.kind, site: s.site, language: s.language, title: s.title, revid: s.revid, url: s.url, passages: s.passages })),
    rounds: roundDtos,
    spent: roundDtos.reduce((sum, r) => sum + (r.cost ?? 0), 0),
    running: roundDtos.some((r) => r.status === "running"),
    comparison: compared ? { scores: compared.comparison!, comparedAt: compared.startedAt.toISOString() } : null,
    ratings,
  };
}

/** Spec §34.4: the admin's edit, saved as typed (trimmed). False for an unknown slug. */
export async function saveHighlights(db: Queryable, slug: string, text: string): Promise<boolean> {
  const highlights = text.trim();
  if (highlights.length < 1 || highlights.length > HIGHLIGHTS_EDIT_MAX) {
    throw new RangeError(`Highlights must be 1–${HIGHLIGHTS_EDIT_MAX.toLocaleString("en")} characters.`);
  }
  const { rowCount } = await db.query(`UPDATE personas SET highlights = $2 WHERE slug = $1`, [slug, highlights]);
  return (rowCount ?? 0) > 0;
}

/** What the free lookups and the comparison need. */
export type AdminDeps = {
  pool: Pool;
  client: WikimediaClient;
  prepare: PrepareDeps;
  fetchLanguages: (qid: string) => Promise<PersonaLanguage[]>;
  /** Spec §34.3: the paid scorer, its calls on the given ledger. */
  scoreEditions: (ledger: CostLedger) => ScoreFn;
  /** The helper's price, for the comparison's estimate; null when unknown. */
  helperPrice: () => Promise<Price | null>;
};

/** The real dependencies of find, compare and candidates. */
export function adminDeps(): AdminDeps {
  const pool = getPool();
  return {
    pool,
    client: wikimedia,
    prepare: {
      pool,
      fetchArticle: (title) => wikimedia.extract({ site: "wikipedia", language: "en" }, title),
      fetchPersonFacts: (qid) => fetchPersonFacts(qid),
    },
    fetchLanguages: (qid) => fetchPersonLanguages(qid),
    scoreEditions: (ledger) => editionScorer({ callbacks: [ledger.handler("ingest")] }),
    helperPrice: () => priceOf(modelId("helper")),
  };
}

/**
 * Spec §34.6, §34.9: the real dependencies of one round. Each item's calls are priced, logged
 * against the admin without charging (and linked to the item), and the item's cost stored.
 */
export function roundDeps(adminId: string, personaSlug: string): RoundDeps {
  const pool = getPool();
  return {
    pool,
    client: wikimedia,
    embeddings: (ledger) => meteredEmbeddings(embeddingModel(), ledger, EMBEDDING_MODEL),
    generateProfile: (ledger) => profileGenerator({ callbacks: [ledger.handler("ingest")] }),
    draftHighlights: (ledger) => highlightsDrafter({ callbacks: [ledger.handler("ingest")] }),
    fetchLanguages: (qid) => fetchPersonLanguages(qid),
    onItemCalls: async (itemId, calls) => {
      const resolved = await resolveCosts(calls);
      await recordCalls(pool, { userId: adminId, calls: resolved, charge: false, personaSlug, ingestItemId: itemId });
      const cost = resolved.reduce((sum, c) => sum + c.cost, 0);
      await setItemCost(pool, itemId, cost);
      return cost;
    },
  };
}

/** An existing persona, or a new one checked by prepareUserPersona (so its slug is free). */
export type AdminTarget =
  | { kind: "existing"; slug: string; persona: PersonaRow; qid: string | null; names: string[] }
  | { kind: "new"; slug: string; entry: PersonaEntry; article: Article; qid: string; names: string[] };

/**
 * Null for an unknown slug. A title runs every check of today's add flow and throws its
 * AddPersonaError, so a living person or a taken slug is refused before anything is paid.
 */
export async function resolveTarget(body: { slug: string } | { title: string }, deps: AdminDeps): Promise<AdminTarget | null> {
  if ("slug" in body) {
    const persona = await findPersona(deps.pool, body.slug);
    if (!persona) return null;
    const names = [...new Set([persona.displayName, persona.wikipediaTitle])];
    return { kind: "existing", slug: persona.slug, persona, qid: persona.wikidataQid, names };
  }
  const { entry, article } = await prepareUserPersona(body.title, deps.prepare);
  // prepareUserPersona refuses an article without a QID.
  const names = [...new Set([entry.displayName ?? article.title, article.title])];
  return { kind: "new", slug: entry.slug, entry, article, qid: article.qid!, names };
}

export function roundTarget(target: AdminTarget): RoundTarget {
  return target.kind === "existing" ? { kind: "existing", persona: target.persona } : { kind: "new", entry: target.entry, qid: target.qid };
}

/** Spec §18.4: a new persona's languages from Wikidata, or English assumed when it lists none. */
export async function newPersonaLanguages(qid: string, deps: AdminDeps): Promise<ProfileLanguage[]> {
  const languages = await deps.fetchLanguages(qid);
  if (languages.length === 0) return FALLBACK_LANGUAGES.map((l) => ({ ...l, source: "none found, English assumed" }));
  return languages.map((l) => ({ ...l, source: "Wikidata" }));
}

/** Spec §34.3: what comparing these editions would cost. An unknown helper price shows nothing rather than failing a free step. */
export async function comparisonEstimateFor(deps: AdminDeps, editionChars: number[]): Promise<number> {
  return comparisonEstimate((await deps.helperPrice()) ?? { prompt: 0, completion: 0 }, editionChars);
}

/** The language codes whose editions are compared. */
export async function targetLanguageCodes(target: AdminTarget, deps: AdminDeps): Promise<string[]> {
  if (target.kind === "existing") return target.persona.languages.map((l) => l.code);
  return (await newPersonaLanguages(target.qid, deps)).map((l) => l.code);
}

/**
 * Spec §34.5: one page of candidates of one kind in one language, each with its embedding
 * estimate. Linked articles and mentions use that language's Wikipedia edition.
 */
export async function listCandidates(
  client: WikimediaClient,
  target: AdminTarget & { qid: string },
  kind: Exclude<SourceKind, "article">,
  language: string,
  offset: number,
): Promise<CandidatesResult> {
  const sitelinks = (await client.sitelinks(target.qid)).filter((l) => l.language === language);
  const edition = sitelinks.find((l) => l.site === "wikipedia");
  const priced = (c: Candidate) => ({ ...c, estimated: embeddingEstimate(c.chars) });

  if (kind === "mention") {
    const names = [...new Set([...target.names, ...(edition ? [edition.title] : [])])];
    const ref = { site: "wikipedia", language } as const;
    const { items, total } = await listMentions(client, ref, edition?.title ?? target.names[0], names, offset, CANDIDATE_PAGE);
    return { items: items.map(priced), total };
  }
  let all: Candidate[] = [];
  if (kind === "writing") all = await listWritings(client, sitelinks);
  else if (kind === "quotes") all = await listQuotes(client, sitelinks);
  else if (edition) {
    const page = await client.extract(edition, edition.title);
    all = await listLinked(client, edition, page.title, page.text);
  }
  return { items: all.slice(offset, offset + CANDIDATE_PAGE).map(priced), total: all.length };
}

/** As today's add route (POST /api/personas). */
const ADD_STATUS: Record<AddPersonaErrorCode, number> = {
  invalid_title: 400,
  not_found: 404,
  disambiguation: 422,
  not_a_person: 422,
  not_deceased: 422,
  too_large: 422,
  conflict: 409,
  unreachable: 502,
};
const ROUND_STATUS: Record<RoundErrorCode, number> = { round_running: 409, too_large: 422, empty_article: 422, persona_gone: 404 };
const INGEST_STATUS: Record<IngestError["code"], number> = { in_progress: 409, empty_article: 422 };

/** The status and code of a known refusal, or null for anything else (a database or model error). */
function refusal(err: unknown): { status: number; code: string } | null {
  if (err instanceof AddPersonaError) return { status: ADD_STATUS[err.code], code: err.code };
  if (err instanceof WikipediaError) return { status: ADD_STATUS[err.code], code: err.code };
  if (err instanceof RoundError) return { status: ROUND_STATUS[err.code], code: err.code };
  if (err instanceof IngestError) return { status: INGEST_STATUS[err.code], code: err.code };
  return null;
}

/** A route's JSON answer to an error: refusals keep their status; anything else is a 503 (spec §24.9). */
export function adminError(err: unknown): Response {
  const known = refusal(err);
  if (!known) return unavailable(err, { showMessage: true });
  const existing = err instanceof AddPersonaError && err.existing ? toPersona(err.existing, NO_VOICE) : undefined;
  return Response.json({ error: (err as Error).message, code: known.code, persona: existing }, { status: known.status });
}

/** The stream's last line when a round fails after it started streaming. */
export function roundErrorEvent(err: unknown): RoundEvent {
  const known = refusal(err);
  if (known) return { type: "error", message: (err as Error).message, code: known.code };
  if (err instanceof EmbeddingDimensionError) return { type: "error", message: "The embedding model is misconfigured. Check the server log." };
  return { type: "error", message: describeDbError(err) ?? "The round failed. Try again in a moment." };
}
