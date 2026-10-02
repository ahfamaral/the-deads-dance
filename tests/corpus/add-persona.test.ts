import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import { AddPersonaError, prepareUserPersona } from "../../corpus/add-persona";
import { closePool, getPool } from "../../corpus/db";
import { WikipediaError, type PersonFacts } from "../../corpus/wikipedia";
import { insertPersona, resetDb } from "../helpers/db";
import { article } from "../fixtures/articles";

const human: PersonFacts = { isHuman: true, isDeceased: true, description: "Chinese-American physicist", lifespan: "1912–1997" };

function deps(overrides: Partial<Parameters<typeof prepareUserPersona>[1]> = {}) {
  return {
    pool: getPool(),
    fetchArticle: vi.fn(async () => article()),
    fetchPersonFacts: vi.fn(async () => human),
    ...overrides,
  };
}

async function codeOf(promise: Promise<unknown>): Promise<string> {
  const err = await promise.then(
    () => null,
    (e) => e,
  );
  expect(err).toBeInstanceOf(AddPersonaError);
  return err.code;
}

beforeEach(() => resetDb());
afterAll(() => closePool());

describe("prepareUserPersona", () => {
  it("builds a user entry from the article and Wikidata", async () => {
    const { entry, article: fetched } = await prepareUserPersona("  Chien-Shiung Wu ", deps());
    expect(entry).toEqual({
      slug: "chien-shiung-wu",
      wikipediaTitle: "Chien-Shiung Wu",
      displayName: "Chien-Shiung Wu",
      description: "Chinese-American physicist",
      lifespan: "1912–1997",
      origin: "user",
    });
    expect(fetched.qid).toBe("Q450317");
  });

  it("rejects empty and over-long titles without fetching", async () => {
    const d = deps();
    expect(await codeOf(prepareUserPersona("   ", d))).toBe("invalid_title");
    expect(await codeOf(prepareUserPersona("x".repeat(201), d))).toBe("invalid_title");
    expect(d.fetchArticle).not.toHaveBeenCalled();
  });

  it("passes through Wikipedia's not_found, disambiguation and unreachable", async () => {
    for (const code of ["not_found", "disambiguation", "unreachable"] as const) {
      const d = deps({ fetchArticle: vi.fn(async () => Promise.reject(new WikipediaError(code, code))) });
      expect(await codeOf(prepareUserPersona("X", d))).toBe(code);
    }
  });

  it("rejects an article that is not about a person", async () => {
    const d = deps({ fetchPersonFacts: vi.fn(async () => ({ ...human, isHuman: false })) });
    expect(await codeOf(prepareUserPersona("Photosynthesis", d))).toBe("not_a_person");
  });

  it("rejects a living person before anything is embedded", async () => {
    const d = deps({ fetchPersonFacts: vi.fn(async () => ({ ...human, isDeceased: false, lifespan: "born 1950" })) });
    const err = await prepareUserPersona("Someone Alive", d).catch((e) => e);
    expect(err).toBeInstanceOf(AddPersonaError);
    expect(err.code).toBe("not_deceased");
    expect(err.message).toMatch(/living person.*died/);
  });

  it("rejects an article with no Wikidata item", async () => {
    const d = deps({ fetchArticle: vi.fn(async () => article({ qid: null })) });
    expect(await codeOf(prepareUserPersona("X", d))).toBe("not_a_person");
  });

  it("rejects an oversized article", async () => {
    const d = deps({ fetchArticle: vi.fn(async () => article({ text: "a".repeat(300_001) })) });
    expect(await codeOf(prepareUserPersona("X", d))).toBe("too_large");
  });

  // Review Focus 1: "Einstein" redirects to "Albert Einstein", which is already there.
  it("returns the existing persona when a redirect lands on one", async () => {
    await insertPersona({ slug: "albert-einstein", displayName: "Albert Einstein", origin: "curated" });
    const d = deps({ fetchArticle: vi.fn(async () => article({ title: "Albert Einstein", qid: "Q937" })) });
    const err = await prepareUserPersona("Einstein", d).catch((e) => e);
    expect(err.code).toBe("conflict");
    expect(err.existing).toMatchObject({ slug: "albert-einstein", displayName: "Albert Einstein" });
  });

  // Review Focus 2: a second add while the first is still running.
  it("reports a conflict while the same persona is being added", async () => {
    await insertPersona({ slug: "chien-shiung-wu", origin: "user", status: "ingesting", updatedMinutesAgo: 1 });
    expect(await codeOf(prepareUserPersona("Chien-Shiung Wu", deps()))).toBe("conflict");
  });

  it("refuses to take over a non-ready curated persona", async () => {
    await insertPersona({ slug: "chien-shiung-wu", origin: "curated", status: "failed" });
    expect(await codeOf(prepareUserPersona("Chien-Shiung Wu", deps()))).toBe("conflict");
  });

  it("allows retrying a failed or stale add", async () => {
    await insertPersona({ slug: "chien-shiung-wu", origin: "user", status: "failed" });
    await expect(prepareUserPersona("Chien-Shiung Wu", deps())).resolves.toBeDefined();
    await getPool().query("UPDATE personas SET status = 'ingesting', updated_at = now() - interval '11 minutes'");
    await expect(prepareUserPersona("Chien-Shiung Wu", deps())).resolves.toBeDefined();
  });
});
