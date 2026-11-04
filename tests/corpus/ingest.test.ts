import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import { closePool, getPool } from "../../corpus/db";
import { EmbeddingDimensionError } from "../../corpus/embeddings";
import { BUILD_STAMP, IngestError, ingestPersona, type PersonaEntry } from "../../corpus/ingest";
import type { PersonaLanguage } from "../../corpus/languages";
import { findPersona } from "../../corpus/personas";
import { CURATED_PROFILE_STAMP, profileStamp, type CharacterProfile, type GenerateProfile } from "../../corpus/profile";
import { FakeEmbeddings } from "../helpers/fake-embeddings";
import { insertPersona, resetDb } from "../helpers/db";
import { article } from "../fixtures/articles";

const entry: PersonaEntry = {
  slug: "chien-shiung-wu",
  wikipediaTitle: "Chien-Shiung Wu",
  origin: "curated",
  displayName: "Chien-Shiung Wu",
  description: "Experimental physicist",
  lifespan: "1912–1997",
};

const PROFILE: CharacterProfile = {
  temperament: "Exacting, reserved",
  humour: "unknown",
  passions: "Beta decay",
  indifferences: "unknown",
  speech: "Precise, formal",
  sore_points: "Being passed over",
};
const PINNED: CharacterProfile = { ...PROFILE, temperament: "Reviewed: exacting, warm with students" };

const profileFake = (profile = PROFILE) => vi.fn<GenerateProfile>(async () => profile);
const failingProfile = () =>
  vi.fn<GenerateProfile>(async () => {
    throw new Error("helper model down");
  });

const LANGS: PersonaLanguage[] = [
  { code: "zh", name: "Chinese", native: true },
  { code: "en", name: "English", native: false },
];
const languagesFake = (langs = LANGS) => vi.fn(async (_qid: string) => langs);

function deps(embeddings = new FakeEmbeddings(), generateProfile = profileFake(), fetchLanguages = languagesFake()) {
  return { pool: getPool(), embeddings, fetchArticle: vi.fn(async () => article()), generateProfile, fetchLanguages };
}

async function chunkCount(slug: string): Promise<number> {
  const { rows } = await getPool().query(
    "SELECT count(*)::int AS n FROM chunks c JOIN personas p ON p.id = c.persona_id WHERE p.slug = $1",
    [slug],
  );
  return rows[0].n;
}

beforeEach(() => resetDb());
afterAll(() => closePool());

/** Spec §6/§17.5: every stage starts and finishes; profiling overlaps embedding. */
function expectStages(steps: string[]) {
  expect(steps.slice(0, 6)).toEqual([
    "fetching:started",
    "fetching:finished",
    "chunking:started",
    "chunking:finished",
    "embedding:started",
    "profiling:started",
  ]);
  expect(steps.slice(6, 8).sort()).toEqual(["embedding:finished", "profiling:finished"]);
  expect(steps.slice(8)).toEqual(["saving:started", "saving:finished"]);
}

describe("ingestPersona", () => {
  it("ingests a new persona and reports each step", async () => {
    const d = deps();
    const steps: string[] = [];
    const result = await ingestPersona(entry, d, { onProgress: (p) => steps.push(`${p.step}:${p.status}`) });

    expect(result.outcome).toBe("ingested");
    expect(result.chunkCount).toBeGreaterThan(0);
    expect(await chunkCount("chien-shiung-wu")).toBe(result.chunkCount);
    expectStages(steps);
    expect(result.persona).toMatchObject({
      status: "ready",
      buildStamp: BUILD_STAMP,
      wikipediaRevid: 1374160316,
      wikidataQid: "Q450317",
      description: "Experimental physicist",
    });
    expect(result.persona.sourceText).toContain("Chien-Shiung Wu");
  });

  it("skips an unchanged persona without fetching or embedding", async () => {
    await ingestPersona(entry, deps());
    const d = deps();
    const result = await ingestPersona(entry, d);
    expect(result.outcome).toBe("skipped");
    expect(d.fetchArticle).not.toHaveBeenCalled();
    expect((d.embeddings as FakeEmbeddings).calls).toBe(0);
  });

  it("re-embeds from stored text when the build stamp changed", async () => {
    await ingestPersona(entry, deps());
    await getPool().query("UPDATE personas SET build_stamp = 'old' WHERE slug = $1", [entry.slug]);
    const d = deps();
    const result = await ingestPersona(entry, d);
    expect(result.outcome).toBe("ingested");
    expect(d.fetchArticle).not.toHaveBeenCalled();
    expect((d.embeddings as FakeEmbeddings).calls).toBe(1);
    expect(result.persona.buildStamp).toBe(BUILD_STAMP);
  });

  it("fetches again with refresh", async () => {
    await ingestPersona(entry, deps());
    const d = deps();
    await ingestPersona(entry, d, { refresh: true });
    expect(d.fetchArticle).toHaveBeenCalledOnce();
  });

  it("uses a prefetched article without fetching", async () => {
    const d = deps();
    await ingestPersona(entry, d, { article: article() });
    expect(d.fetchArticle).not.toHaveBeenCalled();
  });

  it("keeps the old version when re-embedding fails", async () => {
    await ingestPersona(entry, deps());
    const before = await chunkCount(entry.slug);
    await getPool().query("UPDATE personas SET build_stamp = 'old' WHERE slug = $1", [entry.slug]);

    const failing = deps(new FakeEmbeddings({ fail: new Error("429 from OpenRouter") }));
    await expect(ingestPersona(entry, failing)).rejects.toThrow(/429/);
    expect(await chunkCount(entry.slug)).toBe(before);
    expect((await findPersona(getPool(), entry.slug))?.status).toBe("ready");
  });

  it("marks a new persona failed when embedding fails", async () => {
    const failing = deps(new FakeEmbeddings({ fail: new Error("429 from OpenRouter") }));
    await expect(ingestPersona(entry, failing)).rejects.toThrow(/429/);
    expect((await findPersona(getPool(), entry.slug))?.status).toBe("failed");
  });

  it("stops on wrong-size vectors", async () => {
    const wrong = deps(new FakeEmbeddings({ dimensions: 3 }));
    await expect(ingestPersona(entry, wrong)).rejects.toBeInstanceOf(EmbeddingDimensionError);
    expect((await findPersona(getPool(), entry.slug))?.status).toBe("failed");
  });

  it("retries a failed persona", async () => {
    await insertPersona({ slug: entry.slug, status: "failed" });
    expect((await ingestPersona(entry, deps())).outcome).toBe("ingested");
  });

  it("refuses while another ingest of the same persona is running", async () => {
    await insertPersona({ slug: entry.slug, status: "ingesting", updatedMinutesAgo: 1 });
    await expect(ingestPersona(entry, deps())).rejects.toMatchObject({ code: "in_progress" });
  });

  it("takes over an ingest stuck for more than 10 minutes", async () => {
    await insertPersona({ slug: entry.slug, status: "ingesting", updatedMinutesAgo: 11 });
    expect((await ingestPersona(entry, deps())).outcome).toBe("ingested");
  });

  it("rejects an article with no text", async () => {
    const d = deps();
    await expect(ingestPersona(entry, d, { article: article({ text: "" }) })).rejects.toBeInstanceOf(IngestError);
    expect((await findPersona(getPool(), entry.slug))?.status).toBe("failed");
  });

  it("updates metadata on rerun without re-fetching or re-embedding", async () => {
    await ingestPersona(entry, deps());
    const before = await chunkCount(entry.slug);
    const d = deps();
    const result = await ingestPersona({ ...entry, description: "Changed" }, d);

    expect(result.outcome).toBe("updated");
    expect(result.persona.description).toBe("Changed");
    expect(d.fetchArticle).not.toHaveBeenCalled();
    expect((d.embeddings as FakeEmbeddings).calls).toBe(0);
    expect(await chunkCount(entry.slug)).toBe(before);
  });

  it("updates origin when a curated manifest entry claims a ready user persona's slug", async () => {
    await ingestPersona({ ...entry, origin: "user" }, deps());
    expect((await findPersona(getPool(), entry.slug))?.origin).toBe("user");

    const d = deps();
    const result = await ingestPersona({ ...entry, origin: "curated" }, d);
    expect(result.outcome).toBe("updated");
    expect(result.persona.origin).toBe("curated");
    expect(d.fetchArticle).not.toHaveBeenCalled();
    expect((d.embeddings as FakeEmbeddings).calls).toBe(0);
  });

  it("still skips an unchanged rerun", async () => {
    await ingestPersona(entry, deps());
    const d = deps();
    const result = await ingestPersona(entry, d);
    expect(result.outcome).toBe("skipped");
  });
  it("generates and stores a profile for a new persona, alongside embedding", async () => {
    const d = deps();
    const steps: string[] = [];
    const result = await ingestPersona(entry, d, { onProgress: (p) => steps.push(`${p.step}:${p.status}`) });
    expect(result.persona).toMatchObject({ profile: PROFILE, profileStamp: profileStamp() });
    expect(d.generateProfile).toHaveBeenCalledOnce();
    expect(d.generateProfile.mock.calls[0][0]).toContain("Chien-Shiung Wu");
    expectStages(steps);
  });

  it("still makes a new persona ready when profile generation fails", async () => {
    const quiet = vi.spyOn(console, "error").mockImplementation(() => {});
    const result = await ingestPersona(entry, deps(undefined, failingProfile()));
    expect(quiet).toHaveBeenCalledWith(expect.stringMatching(/Character profile for chien-shiung-wu failed.*helper model down/));
    quiet.mockRestore();
    expect(result.outcome).toBe("ingested");
    expect(result.persona).toMatchObject({ status: "ready", profile: null, profileStamp: null });
  });

  it("regenerates only the profile when its stamp is stale", async () => {
    await ingestPersona(entry, deps());
    await getPool().query("UPDATE personas SET profile_stamp = 'old' WHERE slug = $1", [entry.slug]);
    const fresh: CharacterProfile = { ...PROFILE, humour: "Dry" };
    const d = deps(undefined, profileFake(fresh));
    const result = await ingestPersona(entry, d);

    expect(result.outcome).toBe("updated");
    expect(result.persona).toMatchObject({ profile: fresh, profileStamp: profileStamp() });
    expect(d.generateProfile.mock.calls[0][0]).toContain("Chien-Shiung Wu");
    expect(d.fetchArticle).not.toHaveBeenCalled();
    expect((d.embeddings as FakeEmbeddings).calls).toBe(0);
  });

  it("keeps the previous profile and skips when regeneration fails", async () => {
    await ingestPersona(entry, deps());
    await getPool().query("UPDATE personas SET profile_stamp = 'old' WHERE slug = $1", [entry.slug]);
    const before = (await findPersona(getPool(), entry.slug))!.updatedAt;

    const quiet = vi.spyOn(console, "error").mockImplementation(() => {});
    const result = await ingestPersona(entry, deps(undefined, failingProfile()));
    quiet.mockRestore();
    expect(result.outcome).toBe("skipped");
    const after = await findPersona(getPool(), entry.slug);
    expect(after).toMatchObject({ profile: PROFILE, profileStamp: "old" });
    expect(after!.updatedAt).toEqual(before);
  });

  it("does not regenerate a current profile when re-embedding", async () => {
    await ingestPersona(entry, deps());
    await getPool().query("UPDATE personas SET build_stamp = 'old' WHERE slug = $1", [entry.slug]);
    const d = deps();
    const result = await ingestPersona(entry, d);
    expect(result.outcome).toBe("ingested");
    expect(d.generateProfile).not.toHaveBeenCalled();
    expect(result.persona.profile).toEqual(PROFILE);
  });

  it("stores a pinned profile without generating one", async () => {
    const d = deps();
    const result = await ingestPersona({ ...entry, profile: PINNED }, d);
    expect(d.generateProfile).not.toHaveBeenCalled();
    expect(result.persona).toMatchObject({ profile: PINNED, profileStamp: CURATED_PROFILE_STAMP });
  });

  it("treats a changed pinned profile as an update, and an unchanged one as a skip", async () => {
    await ingestPersona({ ...entry, profile: PINNED }, deps());
    expect((await ingestPersona({ ...entry, profile: PINNED }, deps())).outcome).toBe("skipped");

    const changed = { ...PINNED, speech: "Brisk" };
    const d = deps();
    const result = await ingestPersona({ ...entry, profile: changed }, d);
    expect(result.outcome).toBe("updated");
    expect(result.persona.profile).toEqual(changed);
    expect(d.generateProfile).not.toHaveBeenCalled();
    expect((d.embeddings as FakeEmbeddings).calls).toBe(0);
  });

  it("generates a profile again after one is unpinned", async () => {
    await ingestPersona({ ...entry, profile: PINNED }, deps());
    const d = deps();
    const result = await ingestPersona(entry, d);
    expect(result.outcome).toBe("updated");
    expect(d.generateProfile).toHaveBeenCalledOnce();
    expect(result.persona).toMatchObject({ profile: PROFILE, profileStamp: profileStamp() });
  });

  it("sends no profiling stage for a pinned profile", async () => {
    const steps: string[] = [];
    await ingestPersona({ ...entry, profile: PINNED }, deps(), { onProgress: (p) => steps.push(`${p.step}:${p.status}`) });
    expect(steps.some((s) => s.startsWith("profiling"))).toBe(false);
    expect(steps.slice(-2)).toEqual(["saving:started", "saving:finished"]);
  });

  // Review Focus 3: a failed generation still finishes its stage, so the form's bar can't hang.
  it("finishes the profiling stage even when generation fails", async () => {
    const quiet = vi.spyOn(console, "error").mockImplementation(() => {});
    const steps: string[] = [];
    await ingestPersona(entry, deps(undefined, failingProfile()), { onProgress: (p) => steps.push(`${p.step}:${p.status}`) });
    quiet.mockRestore();
    expect(steps).toContain("profiling:finished");
    expect(steps.slice(-2)).toEqual(["saving:started", "saving:finished"]);
  });

  it("fetches and stores languages for a new persona by its QID", async () => {
    const d = deps();
    const result = await ingestPersona(entry, d);
    expect(d.fetchLanguages).toHaveBeenCalledWith("Q450317");
    expect(result.persona.storedLanguages).toEqual(LANGS);
  });

  it("stores a pinned language list without fetching", async () => {
    const d = deps();
    const pinned: PersonaLanguage[] = [{ code: "en", name: "English", native: true }];
    const result = await ingestPersona({ ...entry, languages: pinned }, d);
    expect(d.fetchLanguages).not.toHaveBeenCalled();
    expect(result.persona.storedLanguages).toEqual(pinned);
  });

  it("still makes the persona ready when the language lookup fails, and retries next run", async () => {
    const quiet = vi.spyOn(console, "error").mockImplementation(() => {});
    const failing = vi.fn(async () => {
      throw new Error("wikidata down");
    });
    const first = await ingestPersona(entry, deps(new FakeEmbeddings(), profileFake(), failing));
    expect(first.persona).toMatchObject({ status: "ready", storedLanguages: null });
    quiet.mockRestore();

    const d = deps();
    const second = await ingestPersona(entry, d);
    expect(second.outcome).toBe("updated");
    expect(second.persona.storedLanguages).toEqual(LANGS);
    expect(d.fetchArticle).not.toHaveBeenCalled();
  });

  it("keeps stored languages on a rerun and skips an unchanged persona", async () => {
    await ingestPersona(entry, deps());
    const d = deps();
    const again = await ingestPersona(entry, d);
    expect(again.outcome).toBe("skipped");
    expect(d.fetchLanguages).not.toHaveBeenCalled();
  });

  it("treats a changed pinned language list as an update", async () => {
    await ingestPersona(entry, deps());
    const pinned: PersonaLanguage[] = [{ code: "zh", name: "Chinese", native: true }];
    const result = await ingestPersona({ ...entry, languages: pinned }, deps());
    expect(result.outcome).toBe("updated");
    expect(result.persona.storedLanguages).toEqual(pinned);
  });

  it("leaves one English article source, recorded as a finished round, and points every chunk at it (spec §34.2)", async () => {
    await ingestPersona(entry, deps());
    await getPool().query("UPDATE personas SET build_stamp = 'old' WHERE slug = $1", [entry.slug]);
    const result = await ingestPersona(entry, deps());

    const { rows: sources } = await getPool().query(
      "SELECT id, kind, language, site, title, revid, url, passages, round_id FROM persona_sources WHERE persona_id = $1",
      [result.persona.id],
    );
    expect(sources).toEqual([
      expect.objectContaining({
        kind: "article", language: "en", site: "wikipedia", title: "Chien-Shiung Wu", revid: "1374160316",
        url: "https://en.wikipedia.org/wiki/Chien-Shiung_Wu", passages: result.chunkCount,
      }),
    ]);
    const { rows: unlinked } = await getPool().query(
      "SELECT count(*)::int AS n FROM chunks WHERE persona_id = $1 AND source_id IS DISTINCT FROM $2",
      [result.persona.id, sources[0].id],
    );
    expect(unlinked[0].n).toBe(0);
    const { rows: rounds } = await getPool().query("SELECT status FROM ingest_rounds WHERE id = $1", [sources[0].round_id]);
    expect(rounds[0].status).toBe("done");
  });
});
