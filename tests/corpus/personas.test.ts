import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { closePool, getPool } from "../../corpus/db";
import { deletePersona, findPersona, listReadyPersonas, setPersonaHidden } from "../../corpus/personas";
import { insertChunks, insertPersona, resetDb } from "../helpers/db";
import { vectorFor } from "../helpers/fake-embeddings";

beforeEach(() => resetDb());
afterAll(() => closePool());

describe("findPersona", () => {
  it("returns null for an unknown slug", async () => {
    expect(await findPersona(getPool(), "nobody")).toBeNull();
  });

  it("maps a row to camelCase with numeric revid", async () => {
    await insertPersona({ slug: "chien-shiung-wu", displayName: "Chien-Shiung Wu" });
    await getPool().query("UPDATE personas SET wikipedia_revid = 1374160316 WHERE slug = 'chien-shiung-wu'");
    const row = await findPersona(getPool(), "chien-shiung-wu");
    expect(row).toMatchObject({
      slug: "chien-shiung-wu",
      displayName: "Chien-Shiung Wu",
      origin: "curated",
      status: "ready",
      wikipediaRevid: 1374160316,
    });
    expect(row?.updatedAt).toBeInstanceOf(Date);
  });

  it("reads a stored profile, and null for one that doesn't match the schema", async () => {
    const profile = {
      temperament: "Exacting",
      humour: "unknown",
      passions: "Beta decay",
      indifferences: "unknown",
      speech: "Precise",
      sore_points: "unknown",
    };
    await insertPersona({ slug: "good" });
    await insertPersona({ slug: "stale" });
    await getPool().query("UPDATE personas SET profile = $1::jsonb, profile_stamp = 'curated' WHERE slug = 'good'", [
      JSON.stringify(profile),
    ]);
    await getPool().query(`UPDATE personas SET profile = '{"voice": "old shape"}'::jsonb WHERE slug = 'stale'`);

    expect(await findPersona(getPool(), "good")).toMatchObject({ profile, profileStamp: "curated" });
    expect((await findPersona(getPool(), "stale"))?.profile).toBeNull();
  });
});

describe("listReadyPersonas", () => {
  it("lists only ready personas, curated first", async () => {
    await insertPersona({ slug: "user-one", origin: "user" });
    await insertPersona({ slug: "curated-one", origin: "curated" });
    await insertPersona({ slug: "half-done", origin: "user", status: "ingesting" });
    await insertPersona({ slug: "broken", origin: "user", status: "failed" });
    const slugs = (await listReadyPersonas(getPool())).map((p) => p.slug);
    expect(slugs).toEqual(["curated-one", "user-one"]);
  });
});

describe("deletePersona", () => {
  it("deletes a user persona and its chunks", async () => {
    const id = await insertPersona({ slug: "user-one", origin: "user" });
    await insertChunks(id, [vectorFor("a")]);
    expect(await deletePersona(getPool(), "user-one")).toBe("deleted");
    const { rows } = await getPool().query("SELECT count(*)::int AS n FROM chunks");
    expect(rows[0].n).toBe(0);
  });

  it("refuses a curated persona and leaves it in place", async () => {
    await insertPersona({ slug: "albert-einstein", origin: "curated" });
    expect(await deletePersona(getPool(), "albert-einstein")).toBe("curated");
    expect(await findPersona(getPool(), "albert-einstein")).not.toBeNull();
  });

  it("reports an unknown slug", async () => {
    expect(await deletePersona(getPool(), "nobody")).toBe("not_found");
  });
});

describe("persona languages", () => {
  it("reads a persona with no stored languages as speaking English", async () => {
    await insertPersona({ slug: "plain" });
    const row = await findPersona(getPool(), "plain");
    expect(row?.storedLanguages).toBeNull();
    expect(row?.languages).toEqual([{ code: "en", name: "English", native: true }]);
  });

  // Spec §33.4: the picker's voice icon is derived from the languages, so summaries carry them.
  it("gives the summaries the persona selection screen reads their languages, English when none are stored", async () => {
    await insertPersona({ slug: "plain" });
    const [summary] = await listReadyPersonas(getPool());
    expect(summary.languages).toEqual([{ code: "en", name: "English", native: true }]);
  });
});

// 2026-10-16: the admin hides a persona from testers' picker.
describe("setPersonaHidden", () => {
  it("hides and shows a persona, built-in or added, and the list says which", async () => {
    await insertPersona({ slug: "albert-einstein", origin: "curated" });
    await insertPersona({ slug: "user-one", origin: "user" });
    expect((await listReadyPersonas(getPool())).map((p) => [p.slug, p.hidden])).toEqual([
      ["albert-einstein", false],
      ["user-one", false],
    ]);
    expect(await setPersonaHidden(getPool(), "albert-einstein", true)).toBe(true);
    expect(await setPersonaHidden(getPool(), "user-one", true)).toBe(true);
    expect((await findPersona(getPool(), "albert-einstein"))?.hidden).toBe(true);
    expect(await setPersonaHidden(getPool(), "albert-einstein", false)).toBe(true);
    expect((await listReadyPersonas(getPool())).map((p) => [p.slug, p.hidden])).toEqual([
      ["albert-einstein", false],
      ["user-one", true],
    ]);
  });

  it("reports an unknown slug", async () => {
    expect(await setPersonaHidden(getPool(), "nobody", true)).toBe(false);
  });
});
