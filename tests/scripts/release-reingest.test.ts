import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import { meteredEmbeddings } from "@corpus/cost-ledger";
import { closePool, getPool } from "@corpus/db";
import { embeddingEstimate } from "@corpus/estimate";
import { ingestPersona, type PersonaEntry } from "@corpus/ingest";
import type { PersonaLanguage } from "@corpus/languages";
import type { CharacterProfile } from "@corpus/profile";
import type { RoundDeps } from "@corpus/reingest";
import { listRounds, listSources } from "@corpus/rounds";
import { WikipediaError, type Article, type Sitelink, type WikiRef, type WikimediaClient } from "@corpus/wikimedia";
import { formatDollars as fmt } from "@/lib/money";
import type { AdminDeps } from "@/lib/server/persona-admin";
import { grantAdmin } from "../../scripts/admin-grant";
import { releaseReingest, type ReleaseSpec } from "../../scripts/release-reingest";
import { article, paragraph } from "../fixtures/articles";
import { FakeEmbeddings } from "../helpers/fake-embeddings";
import { resetAuth, resetDb } from "../helpers/db";

const pool = () => getPool();

const WU: PersonaEntry = {
  slug: "chien-shiung-wu",
  wikipediaTitle: "Chien-Shiung Wu",
  origin: "curated",
  displayName: "Chien-Shiung Wu",
  description: "Experimental physicist",
  lifespan: "1912–1997",
};
const PROFILE: CharacterProfile = {
  temperament: "Exacting", humour: "unknown", passions: "Beta decay", indifferences: "unknown", speech: "Precise", sore_points: "unknown",
};
const LANGS: PersonaLanguage[] = [
  { code: "zh", name: "Chinese", native: true },
  { code: "pt", name: "Portuguese", native: false },
];

const PT_TEXT = `Wu Chien-Shiung foi uma física experimental. ${paragraph("Resumo", 30)}\n\n== Infância ==\n${paragraph("Infância", 30)}`;
const PT_QUOTES = ["Wu Chien-Shiung foi uma física.", "", "== Citações ==", "É a coragem de duvidar do que há muito foi estabelecido."].join("\n");
const PARIDADE = "A paridade é uma simetria.\n\nWu Chien-Shiung mostrou em 1956 que a paridade não se conserva.";

const pageKey = (ref: WikiRef, title: string) => `${ref.site}:${ref.language}:${title}`;
const PAGES: Record<string, Article> = {
  "wikipedia:en:Chien-Shiung Wu": article(),
  "wikipedia:pt:Wu Chien-Shiung": { title: "Wu Chien-Shiung", revid: 555, qid: "Q450317", text: PT_TEXT },
  "wikiquote:pt:Wu Chien-Shiung": { title: "Wu Chien-Shiung", revid: 66, qid: null, text: PT_QUOTES },
  "wikipedia:pt:Paridade": { title: "Paridade", revid: 99, qid: null, text: PARIDADE },
  "wikipedia:pt:Física": { title: "Física", revid: 100, qid: null, text: "A física estuda a natureza." },
};
const SITELINKS: Sitelink[] = [
  { site: "wikipedia", language: "en", title: "Chien-Shiung Wu", badges: [] },
  { site: "wikipedia", language: "pt", title: "Wu Chien-Shiung", badges: [] },
  { site: "wikiquote", language: "pt", title: "Wu Chien-Shiung", badges: [] },
];

/** The free lookups use only extract and sitelinks; anything else would be a surprise. */
function fakeClient(): WikimediaClient {
  const unused = async () => {
    throw new Error("not used by the release plan");
  };
  return {
    extract: async (ref, title) => {
      const page = PAGES[pageKey(ref, title)];
      if (!page) throw new WikipediaError("not_found", `No page "${title}".`);
      return page;
    },
    sitelinks: async () => SITELINKS,
    getJson: unused, links: unused, backlinks: unused, search: unused, pageLengths: unused,
  };
}

function adminDeps(): AdminDeps {
  const never = () => {
    throw new Error("a paid or add-flow dependency was used");
  };
  return {
    pool: pool(),
    client: fakeClient(),
    prepare: { pool: pool(), fetchArticle: never, fetchPersonFacts: never },
    fetchLanguages: never,
    scoreEditions: never,
    helperPrice: async () => ({ prompt: 0.1, completion: 0.4 }),
  };
}

/** A round with fake embeddings: the real runner, no network. */
function fakeRoundDeps(): RoundDeps {
  const never = () => {
    throw new Error("the release round doesn't redraft");
  };
  return {
    pool: pool(),
    client: fakeClient(),
    embeddings: (ledger) => meteredEmbeddings(new FakeEmbeddings(), ledger, "test-embedding"),
    generateProfile: never,
    draftHighlights: never,
    fetchLanguages: never,
    onItemCalls: async () => 0,
  };
}

const SPECS: Record<string, ReleaseSpec> = { "chien-shiung-wu": { language: "pt", quotes: true, mentions: ["Paridade"] } };

let adminId: string;
beforeEach(async () => {
  await resetDb();
  await resetAuth();
  await pool().query("TRUNCATE ingest_rounds RESTART IDENTITY CASCADE");
  await ingestPersona(WU, {
    pool: pool(),
    embeddings: new FakeEmbeddings(),
    fetchArticle: async () => article(),
    generateProfile: async () => PROFILE,
    fetchLanguages: async () => LANGS,
  });
  adminId = (await grantAdmin(pool(), "admin@example.com")).userId;
});
afterAll(() => closePool());

describe("release reingest (spec §34.10)", () => {
  it("prints the plan from the free lookups and builds no paid dependency without --confirm", async () => {
    const lines: string[] = [];
    const roundDeps = vi.fn(fakeRoundDeps);
    const result = await releaseReingest(["chien-shiung-wu"], { admin: adminDeps(), roundDeps, log: (l) => lines.push(l), specs: SPECS });

    expect(result).toBeNull();
    expect(roundDeps).not.toHaveBeenCalled();
    const article = embeddingEstimate(PT_TEXT.length);
    const quotes = embeddingEstimate("É a coragem de duvidar do que há muito foi estabelecido.".length);
    const mention = embeddingEstimate("Wu Chien-Shiung mostrou em 1956 que a paridade não se conserva.".length);
    expect(lines).toEqual([
      `Round for Chien-Shiung Wu (chien-shiung-wu), recorded against admin ${adminId}:`,
      `  replaced article wikipedia:pt:Wu Chien-Shiung (replaces en: Chien-Shiung Wu): about ${fmt(article)} (${article} micro-dollars)`,
      expect.stringMatching(/^ {4}\d+ words$/),
      `  added quotes wikiquote:pt:Wu Chien-Shiung: about ${fmt(quotes)} (${quotes} micro-dollars)`,
      "    1 quote, 56 characters",
      `  added mention wikipedia:pt:Paridade: about ${fmt(mention)} (${mention} micro-dollars)`,
      "    63 characters: Wu Chien-Shiung mostrou em 1956 que a paridade não se conserva.",
      `Estimated total: about ${fmt(article + quotes + mention)}. No redraft of highlights or character.`,
      expect.stringMatching(/^\(Comparing editions, not run here: about \$[\d.]+\.\)$/),
      "Dry run: nothing was spent. Add --confirm to start.",
    ]);
    // Nothing was written: only the seeding ingest's round, the English article still the only source.
    expect((await listRounds(pool(), "chien-shiung-wu")).map((r) => r.number)).toEqual([1]);
    const persona = await pool().query<{ id: number }>("SELECT id FROM personas WHERE slug = 'chien-shiung-wu'");
    expect((await listSources(pool(), persona.rows[0].id)).map((s) => `${s.kind}:${s.language}`)).toEqual(["article:en"]);
  });

  it("runs the planned round with --confirm", async () => {
    const lines: string[] = [];
    const roundDeps = vi.fn(fakeRoundDeps);
    const result = await releaseReingest(["--confirm", "chien-shiung-wu"], { admin: adminDeps(), roundDeps, log: (l) => lines.push(l), specs: SPECS });

    expect(roundDeps).toHaveBeenCalledWith(adminId, "chien-shiung-wu");
    const sources = await listSources(pool(), result!.persona.id);
    expect(sources.map((s) => `${s.kind}:${s.site}:${s.language}:${s.title}`).sort()).toEqual([
      "article:wikipedia:pt:Wu Chien-Shiung",
      "mention:wikipedia:pt:Paridade",
      "quotes:wikiquote:pt:Wu Chien-Shiung",
    ]);
    const { rows } = await pool().query<{ section_heading: string }>(
      "SELECT DISTINCT section_heading FROM chunks WHERE persona_id = $1 ORDER BY section_heading",
      [result!.persona.id],
    );
    expect(rows.map((r) => r.section_heading)).toEqual(["Infância", "Overview", "Paridade", "Wu Chien-Shiung"]);
    expect(lines.at(-1)).toMatch(/^Done: round \d+, \d+ passages, cost \$0\.00\.$/);
  });

  it("refuses a mention page that doesn't name the persona, and an unknown slug, before anything is paid", async () => {
    const roundDeps = vi.fn(fakeRoundDeps);
    const deps = { admin: adminDeps(), roundDeps, log: () => {} };
    await expect(
      releaseReingest(["chien-shiung-wu", "--confirm"], { ...deps, specs: { "chien-shiung-wu": { language: "pt", quotes: false, mentions: ["Física"] } } }),
    ).rejects.toThrow("Física doesn't mention Chien-Shiung Wu.");
    await expect(releaseReingest(["mao-zedong"], { ...deps, specs: SPECS })).rejects.toThrow("Usage: scripts/release-reingest.ts <chien-shiung-wu> [--confirm]");
    expect(roundDeps).not.toHaveBeenCalled();
  });
});
