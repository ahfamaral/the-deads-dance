import type { EmbeddingsInterface } from "@langchain/core/embeddings";
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import { CostLedger, meteredEmbeddings, type ModelCallRecord } from "../../corpus/cost-ledger";
import { closePool, getPool } from "../../corpus/db";
import { BUILD_STAMP, ingestPersona, type PersonaEntry } from "../../corpus/ingest";
import type { PersonaLanguage } from "../../corpus/languages";
import { findPersona, type PersonaRow } from "../../corpus/personas";
import { CURATED_PROFILE_STAMP, profileStamp, type CharacterProfile } from "../../corpus/profile";
import {
  MAX_ROUND_CHARS, planChanges, runRound, type RoundDeps, type RoundProgress, type RoundTarget, type SourcePlan,
} from "../../corpus/reingest";
import { listRounds, listSources, startRound, type SourceRef, type StoredSource } from "../../corpus/rounds";
import { WikipediaError, type Article, type WikiRef, type WikimediaClient } from "../../corpus/wikimedia";
import { article, paragraph } from "../fixtures/articles";
import { FakeEmbeddings } from "../helpers/fake-embeddings";
import { resetDb } from "../helpers/db";

const pool = () => getPool();

const PROFILE: CharacterProfile = {
  temperament: "Exacting, reserved",
  humour: "unknown",
  passions: "Beta decay",
  indifferences: "unknown",
  speech: "Precise, formal",
  sore_points: "Being passed over",
};
const PINNED: CharacterProfile = { ...PROFILE, temperament: "Reviewed: exacting, warm with students" };
const LANGS: PersonaLanguage[] = [
  { code: "zh", name: "Chinese", native: true },
  { code: "en", name: "English", native: false },
];

const WU: PersonaEntry = {
  slug: "chien-shiung-wu",
  wikipediaTitle: "Chien-Shiung Wu",
  origin: "curated",
  displayName: "Chien-Shiung Wu",
  description: "Experimental physicist",
  lifespan: "1912–1997",
  profile: PINNED,
};

const PT_TEXT = [
  `Wu Chien-Shiung foi uma física experimental. ${paragraph("Resumo")}`,
  "",
  "== Infância ==",
  paragraph("Infância", 30),
  "",
  "== Referências ==",
  "Smith 1990, p. 4.",
].join("\n");
const QUOTES_TEXT = [
  "Chien-Shiung Wu was a physicist.",
  "",
  "== Quotes ==",
  "It is the courage to doubt what has long been established.",
  "There is only one thing worse than coming home from the lab to a sink full of dirty dishes.",
  "I wonder whether the tiny atoms and nuclei would agree to the discrimination.",
  "",
  "== Quotes about ==",
  "She was the queen of nuclear research, said a colleague once.",
].join("\n");
const MENTION_TEXT = [
  "A Universidade de Columbia é uma universidade em Nova Iorque.",
  "",
  "== Pesquisa ==",
  "Em 1956, Chien-Shiung Wu fez em Columbia a experiência que mostrou a violação da paridade.",
  "Outros temas de pesquisa.",
].join("\n");

const EN: SourceRef & { kind: "article"; site: "wikipedia" } = { kind: "article", site: "wikipedia", language: "en", title: "Chien-Shiung Wu" };
const PT: SourceRef & { kind: "article"; site: "wikipedia" } = { kind: "article", site: "wikipedia", language: "pt", title: "Wu Chien-Shiung" };
const QUOTES: SourceRef = { kind: "quotes", site: "wikiquote", language: "en", title: "Chien-Shiung Wu" };
const MENTION: SourceRef = { kind: "mention", site: "wikipedia", language: "pt", title: "Universidade de Columbia" };
const LINKED: SourceRef = { kind: "linked", site: "wikipedia", language: "pt", title: "Projeto Manhattan" };

const pageKey = (ref: WikiRef, title: string) => `${ref.site}:${ref.language}:${title}`;
const PAGES: Record<string, Article> = {
  [pageKey(EN, EN.title)]: article(),
  [pageKey(PT, PT.title)]: { title: PT.title, revid: 555, qid: "Q450317", text: PT_TEXT },
  [pageKey(QUOTES, QUOTES.title)]: { title: QUOTES.title, revid: 66, qid: null, text: QUOTES_TEXT },
  [pageKey(MENTION, MENTION.title)]: { title: MENTION.title, revid: 77, qid: null, text: MENTION_TEXT },
  [pageKey(LINKED, LINKED.title)]: { title: LINKED.title, revid: 88, qid: null, text: `O Projeto Manhattan. ${paragraph("Projeto", 20)}` },
};

/** Only `extract` is used by a round; `fail(n)` makes the n-th fetch throw. */
function fakeClient(pages: Record<string, Article> = PAGES, fail?: { call: number; error: Error }) {
  const extract = vi.fn(async (ref: WikiRef, title: string): Promise<Article> => {
    if (fail && extract.mock.calls.length === fail.call) throw fail.error;
    const page = pages[pageKey(ref, title)];
    if (!page) throw new WikipediaError("not_found", `No page "${title}".`);
    return page;
  });
  const unused = async () => {
    throw new Error("not used by a round");
  };
  const client: WikimediaClient = {
    extract, getJson: unused, sitelinks: unused, links: unused, backlinks: unused, search: unused, pageLengths: unused,
  };
  return { client, extract };
}

function roundDeps(client: WikimediaClient, options: { embeddings?: EmbeddingsInterface; languages?: PersonaLanguage[] } = {}) {
  const fake = new FakeEmbeddings();
  const inner = options.embeddings ?? fake;
  const costs = new Map<number, number>();
  let next = 0;
  const onItemCalls = vi.fn(async (itemId: number, calls: ModelCallRecord[]) => {
    next += 1;
    const cost = 1000 * next + calls.length;
    costs.set(itemId, cost);
    return cost;
  });
  const generateProfile = vi.fn(async (_text: string) => PROFILE);
  const draftHighlights = vi.fn(async (_text: string) => "Born in Liuhe; studied in Nanjing and Berkeley.");
  const fetchLanguages = vi.fn(async (_qid: string) => options.languages ?? LANGS);
  const deps: RoundDeps = {
    pool: pool(),
    client,
    embeddings: (ledger: CostLedger) => meteredEmbeddings(inner, ledger, "test-embedding"),
    generateProfile: () => generateProfile,
    draftHighlights: () => draftHighlights,
    fetchLanguages,
    onItemCalls,
  };
  return { deps, fake, costs, onItemCalls, generateProfile, draftHighlights, fetchLanguages };
}

const plan = (overrides: Partial<SourcePlan> = {}): SourcePlan => ({
  article: EN, extras: [], articleEstimated: 30, redraft: false, redraftEstimated: 50, ...overrides,
});
const extra = (ref: SourceRef, estimated = 5) => ({ ...ref, estimated });

/** Wu as the CLI ingests her today: one English article source, a pinned profile. */
async function seedWu(): Promise<PersonaRow> {
  const result = await ingestPersona(WU, {
    pool: pool(),
    embeddings: new FakeEmbeddings(),
    fetchArticle: async () => article(),
    generateProfile: async () => PROFILE,
    fetchLanguages: async () => LANGS,
  });
  return result.persona;
}

async function memory(personaId: number) {
  const { rows: chunks } = await pool().query(
    "SELECT id, source_id, section_heading, content FROM chunks WHERE persona_id = $1 ORDER BY id",
    [personaId],
  );
  return { chunks, sources: await listSources(pool(), personaId) };
}

async function personaColumns(id: number) {
  const { rows } = await pool().query(
    "SELECT profile, profile_stamp, languages, languages_source, highlights, wikipedia_title, wikipedia_revid, status FROM personas WHERE id = $1",
    [id],
  );
  return rows[0];
}

const existing = (persona: PersonaRow): RoundTarget => ({ kind: "existing", persona });

beforeEach(async () => {
  await resetDb();
  await pool().query("TRUNCATE ingest_rounds RESTART IDENTITY CASCADE");
});
afterAll(() => closePool());

describe("planChanges (spec §34.6)", () => {
  const stored = (ref: SourceRef, id: number): StoredSource => ({ ...ref, id, revid: 1, url: "u", passages: 3, roundId: 1 });

  it("replaces a different article, keeps ticked extras, removes unticked ones and adds new ones", () => {
    const current = [stored(EN, 1), stored(QUOTES, 2), stored(MENTION, 3)];
    expect(planChanges(current, plan({ article: PT, extras: [extra(QUOTES), extra(LINKED)] }))).toEqual([
      { action: "replaced", ref: PT, replaces: EN },
      { action: "kept", ref: QUOTES },
      { action: "added", ref: LINKED },
      { action: "removed", ref: MENTION },
    ]);
  });

  it("keeps the same article, adds one when there is none, and accepts refs without ids", () => {
    expect(planChanges([EN], plan())).toEqual([{ action: "kept", ref: EN }]);
    expect(planChanges([], plan({ extras: [extra(QUOTES), extra(QUOTES)] }))).toEqual([
      { action: "added", ref: EN },
      { action: "added", ref: QUOTES },
    ]);
  });
});

describe("runRound (spec §34.6)", () => {
  it("reingests from English to Portuguese with quotes, swapping the memory and recording each item's cost", async () => {
    const wu = await seedWu();
    const { client } = fakeClient();
    const d = roundDeps(client);
    const progress: RoundProgress[] = [];

    const result = await runRound(existing(wu), plan({ article: PT, extras: [extra(QUOTES)] }), "admin-1", d.deps, (p) => progress.push(p));

    const { chunks, sources } = await memory(wu.id);
    expect(sources.map((s) => [s.kind, s.language, s.title, s.revid])).toEqual([
      ["article", "pt", PT.title, 555],
      ["quotes", "en", QUOTES.title, 66],
    ]);
    expect(chunks.some((c) => c.content.includes("Early life sentence"))).toBe(false);
    expect(chunks.every((c) => sources.some((s) => s.id === c.source_id))).toBe(true);
    expect(chunks.filter((c) => c.source_id === sources[1].id).map((c) => c.content)).toHaveLength(3);
    expect(sources[1].passages).toBe(3);

    const columns = await personaColumns(wu.id);
    expect(columns).toMatchObject({ wikipedia_title: PT.title, wikipedia_revid: "555", status: "ready" });
    expect((await findPersona(pool(), wu.slug))?.sourceText).toBe(PT_TEXT);

    const [round] = await listRounds(pool(), wu.slug);
    expect(round.id).toBe(result.roundId);
    expect(round.status).toBe("done");
    const ptPassages = sources[0].passages;
    expect(round.items.map((i) => [i.action, i.label, i.passages, i.estimated])).toEqual([
      ["replaced", `Portuguese article, ${ptPassages} passages (replaced English)`, ptPassages, 30],
      ["added", "Real quotes, 3", 3, 5],
    ]);
    for (const item of round.items) expect(item.cost).toBe(d.costs.get(item.id));
    expect(d.onItemCalls).toHaveBeenCalledTimes(2);
    expect(d.onItemCalls.mock.calls[0][1]).toEqual([expect.objectContaining({ role: "embedding", model: "test-embedding" })]);
    expect(result.cost).toBe(round.items.reduce((sum, i) => sum + (i.cost ?? 0), 0));
    expect(result.passages).toBe(chunks.length);
    expect(result.persona.wikipediaTitle).toBe(PT.title);

    expect(progress).toContainEqual({ label: "Real quotes, 3", status: "finished", spent: result.cost });
  });

  it("leaves a curated persona's pinned profile, languages and highlights alone without redraft (review focus 5)", async () => {
    const wu = await seedWu();
    await pool().query("UPDATE personas SET highlights = 'Reviewed highlights.' WHERE id = $1", [wu.id]);
    const before = await personaColumns(wu.id);
    expect(before.profile_stamp).toBe(CURATED_PROFILE_STAMP);
    const { client } = fakeClient();
    const d = roundDeps(client);

    await runRound(existing(wu), plan({ article: PT, extras: [extra(QUOTES)], redraft: false }), "admin-1", d.deps);

    const after = await personaColumns(wu.id);
    expect(after.profile).toEqual(before.profile);
    expect(after.profile_stamp).toBe(before.profile_stamp);
    expect(after.languages).toEqual(before.languages);
    expect(after.highlights).toBe("Reviewed highlights.");
    expect(d.generateProfile).not.toHaveBeenCalled();
    expect(d.draftHighlights).not.toHaveBeenCalled();
    expect(d.fetchLanguages).not.toHaveBeenCalled();
  });

  it("redrafts profile and highlights from the new article when asked, as a redrafted item", async () => {
    const wu = await seedWu();
    const { client } = fakeClient();
    const d = roundDeps(client);

    await runRound(existing(wu), plan({ article: PT, redraft: true }), "admin-1", d.deps);

    expect(d.generateProfile).toHaveBeenCalledWith(PT_TEXT);
    expect(d.draftHighlights).toHaveBeenCalledWith(PT_TEXT);
    const columns = await personaColumns(wu.id);
    expect(columns).toMatchObject({ profile: PROFILE, profile_stamp: profileStamp(), highlights: "Born in Liuhe; studied in Nanjing and Berkeley." });
    const [round] = await listRounds(pool(), wu.slug);
    const redrafted = round.items.find((i) => i.action === "redrafted");
    expect(redrafted).toMatchObject({ estimated: 50 });
    expect(redrafted?.cost).toBe(d.costs.get(redrafted!.id));
  });

  it("refuses a second round while one is running, before any fetch (review focus 1)", async () => {
    const wu = await seedWu();
    await startRound(pool(), wu.slug, "admin-2");
    const { client, extract } = fakeClient();
    const d = roundDeps(client);

    await expect(runRound(existing(wu), plan({ article: PT }), "admin-1", d.deps)).rejects.toMatchObject({ code: "round_running" });
    expect(extract).not.toHaveBeenCalled();
    expect(d.fake.calls).toBe(0);
  });

  it("fails the round with the old memory untouched when Wikimedia is unreachable mid-fetch (review focus 2)", async () => {
    const wu = await seedWu();
    const before = await memory(wu.id);
    const { client } = fakeClient(PAGES, { call: 3, error: new WikipediaError("unreachable", "pt.wikipedia.org is rate-limiting; try again in a few minutes.") });
    const d = roundDeps(client);

    await expect(
      runRound(existing(wu), plan({ article: PT, extras: [extra(QUOTES), extra(LINKED)] }), "admin-1", d.deps),
    ).rejects.toMatchObject({ code: "unreachable" });

    expect(await memory(wu.id)).toEqual(before);
    expect(d.onItemCalls).not.toHaveBeenCalled();
    expect(d.fake.calls).toBe(0);
    const [round] = await listRounds(pool(), wu.slug);
    expect(round.status).toBe("failed");
    expect((await personaColumns(wu.id)).wikipedia_title).toBe("Chien-Shiung Wu");
  });

  it("records a vanished extra as having nothing to add and carries on (review focus 2)", async () => {
    const wu = await seedWu();
    const gone: SourceRef = { kind: "mention", site: "wikipedia", language: "pt", title: "Página apagada" };
    const { client } = fakeClient();
    const d = roundDeps(client);
    const progress: RoundProgress[] = [];

    await runRound(existing(wu), plan({ extras: [extra(gone), extra(MENTION)] }), "admin-1", d.deps, (p) => progress.push(p));

    const [round] = await listRounds(pool(), wu.slug);
    expect(round.status).toBe("done");
    expect(round.items.map((i) => [i.action, i.label, i.cost])).toEqual([
      ["kept", expect.stringMatching(/^English article, \d+ passages$/), 0],
      ["added", "Mentions: Página apagada had nothing to add", 0],
      ["added", "Mentions: Universidade de Columbia", d.costs.get(round.items[2].id)],
    ]);
    expect(progress).toContainEqual({ label: "Mentions: Página apagada had nothing to add", status: "skipped", spent: 0 });
    const { sources, chunks } = await memory(wu.id);
    expect(sources.map((s) => s.title)).toEqual(["Chien-Shiung Wu", "Universidade de Columbia"]);
    expect(chunks.filter((c) => c.source_id === sources[1].id).map((c) => [c.section_heading, c.content])).toEqual([
      ["Universidade de Columbia", "Em 1956, Chien-Shiung Wu fez em Columbia a experiência que mostrou a violação da paridade."],
    ]);
  });

  it("removes an unticked extra with its passages", async () => {
    const wu = await seedWu();
    const { client } = fakeClient();
    await runRound(existing(wu), plan({ extras: [extra(MENTION)] }), "admin-1", roundDeps(client).deps);
    const fresh = (await findPersona(pool(), wu.slug))!;

    await runRound(existing(fresh), plan(), "admin-1", roundDeps(client).deps);

    const { sources, chunks } = await memory(wu.id);
    expect(sources.map((s) => s.kind)).toEqual(["article"]);
    expect(chunks.every((c) => c.source_id === sources[0].id)).toBe(true);
    const [round] = await listRounds(pool(), wu.slug);
    expect(round.items.map((i) => [i.action, i.label])).toContainEqual(["removed", "Mentions: Universidade de Columbia"]);
  });

  it("fails with persona_gone and leaves nothing behind when the persona is deleted mid-round (review focus 3)", async () => {
    const wu = await seedWu();
    const fake = new FakeEmbeddings();
    const deleting: EmbeddingsInterface = {
      async embedDocuments(texts) {
        await pool().query("DELETE FROM personas WHERE id = $1", [wu.id]);
        return fake.embedDocuments(texts);
      },
      embedQuery: (text) => fake.embedQuery(text),
    };
    const { client } = fakeClient();
    const d = roundDeps(client, { embeddings: deleting });

    await expect(runRound(existing(wu), plan({ article: PT, extras: [extra(QUOTES)] }), "admin-1", d.deps)).rejects.toMatchObject({
      code: "persona_gone",
    });

    const [round] = await listRounds(pool(), wu.slug);
    expect(round.status).toBe("failed");
    const { rows } = await pool().query(
      "SELECT (SELECT count(*)::int FROM persona_sources WHERE persona_id = $1) AS sources, (SELECT count(*)::int FROM chunks WHERE persona_id = $1) AS chunks",
      [wu.id],
    );
    expect(rows[0]).toEqual({ sources: 0, chunks: 0 });
  });

  it(`refuses a round over ${MAX_ROUND_CHARS.toLocaleString("en")} new characters before any embedding`, async () => {
    const wu = await seedWu();
    const big = (title: string): Article => ({ title, revid: 1, qid: null, text: `${paragraph(title, 5000)}` });
    const titles = ["Big one", "Big two", "Big three"];
    const pages = { ...PAGES, ...Object.fromEntries(titles.map((t) => [pageKey(PT, t), big(t)])) };
    expect(big("Big one").text.length).toBeLessThan(300_000);
    const { client } = fakeClient(pages);
    const d = roundDeps(client);
    const extras = titles.map((title) => extra({ kind: "linked", site: "wikipedia", language: "pt", title }));

    await expect(runRound(existing(wu), plan({ extras }), "admin-1", d.deps)).rejects.toMatchObject({ code: "too_large" });
    expect(d.fake.calls).toBe(0);
    expect(d.onItemCalls).not.toHaveBeenCalled();
    expect((await listRounds(pool(), wu.slug))[0].status).toBe("failed");
  });

  it("fails with empty_article when the chosen article is missing", async () => {
    const wu = await seedWu();
    const { client } = fakeClient();
    const d = roundDeps(client);
    const missing = { ...PT, title: "Não existe" };

    await expect(runRound(existing(wu), plan({ article: missing }), "admin-1", d.deps)).rejects.toMatchObject({ code: "empty_article" });
    expect(d.fake.calls).toBe(0);
  });

  it("adds a new persona: ready, origin user, its sources, round 1 done, profile and highlights drafted", async () => {
    const entry: PersonaEntry = {
      slug: "wu-chien-shiung",
      wikipediaTitle: PT.title,
      origin: "user",
      displayName: "Chien-Shiung Wu",
      description: "Física experimental",
      lifespan: "1912–1997",
    };
    const { client } = fakeClient();
    const d = roundDeps(client);

    const result = await runRound({ kind: "new", entry, qid: "Q450317" }, plan({ article: PT, extras: [extra(QUOTES)] }), "admin-1", d.deps);

    expect(result.persona).toMatchObject({
      slug: "wu-chien-shiung", status: "ready", origin: "user", wikidataQid: "Q450317", buildStamp: BUILD_STAMP,
      wikipediaTitle: PT.title, wikipediaRevid: 555, description: "Física experimental", storedLanguages: LANGS,
    });
    expect(d.fetchLanguages).toHaveBeenCalledWith("Q450317");
    const columns = await personaColumns(result.persona.id);
    expect(columns).toMatchObject({
      profile: PROFILE, profile_stamp: profileStamp(), languages_source: "wikidata",
      highlights: "Born in Liuhe; studied in Nanjing and Berkeley.",
    });
    const { sources } = await memory(result.persona.id);
    expect(sources.map((s) => s.kind)).toEqual(["article", "quotes"]);
    const rounds = await listRounds(pool(), entry.slug);
    expect(rounds).toHaveLength(1);
    expect(rounds[0]).toMatchObject({ number: 1, status: "done" });
    expect(rounds[0].items.map((i) => i.action)).toEqual(["added", "added", "redrafted"]);
    expect(rounds[0].items[0].label).toMatch(/^Portuguese article, \d+ passages$/);
  });

  it("stores the English fallback source when Wikidata lists no languages for a new persona", async () => {
    const entry: PersonaEntry = { slug: "wu-chien-shiung", wikipediaTitle: PT.title, origin: "user", displayName: "Chien-Shiung Wu" };
    const { client } = fakeClient();
    const d = roundDeps(client, { languages: [] });

    const result = await runRound({ kind: "new", entry, qid: "Q450317" }, plan({ article: PT }), "admin-1", d.deps);

    expect((await personaColumns(result.persona.id)).languages_source).toBe("fallback");
  });

  it("marks a new persona failed when the swap fails after the claim", async () => {
    const entry: PersonaEntry = { slug: "wu-chien-shiung", wikipediaTitle: PT.title, origin: "user", displayName: "Chien-Shiung Wu" };
    const { client } = fakeClient();
    // pgvector refuses NaN, so the chunk insert inside the swap fails.
    const nan: EmbeddingsInterface = {
      embedDocuments: async (texts) => texts.map(() => Array.from({ length: 1536 }, () => Number.NaN)),
      embedQuery: async () => [],
    };
    const d = roundDeps(client, { embeddings: nan });

    await expect(runRound({ kind: "new", entry, qid: "Q450317" }, plan({ article: PT }), "admin-1", d.deps)).rejects.toThrow(/NaN/);

    expect((await listRounds(pool(), entry.slug))[0].status).toBe("failed");
    expect((await findPersona(pool(), entry.slug))?.status).toBe("failed");
    expect((await memory((await findPersona(pool(), entry.slug))!.id)).sources).toEqual([]);
  });
});
