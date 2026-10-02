import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import { closePool, getPool } from "@corpus/db";
import { findPersona } from "@corpus/personas";
import { languagesFor } from "@/lib/server/persona-languages";
import { insertPersona, resetDb } from "../helpers/db";

const PT = [{ code: "pt", name: "Portuguese", native: true }];

beforeEach(async () => {
  await resetDb();
  await insertPersona({ slug: "goulart", origin: "user", wikidataQid: "Q34982" });
});
afterAll(() => closePool());

const goulart = async () => (await findPersona(getPool(), "goulart"))!;

describe("languagesFor (spec §18.4 backfill)", () => {
  it("fetches, stores and returns the languages when none are stored", async () => {
    const fetchLanguages = vi.fn(async () => PT);
    expect(await languagesFor(await goulart(), { pool: getPool(), fetchLanguages })).toEqual(PT);
    expect((await goulart()).storedLanguages).toEqual(PT);
  });

  it("doesn't fetch again once languages are stored, even an empty list", async () => {
    await getPool().query("UPDATE personas SET languages = '[]'::jsonb");
    const fetchLanguages = vi.fn(async () => PT);
    expect(await languagesFor(await goulart(), { pool: getPool(), fetchLanguages })).toEqual([
      { code: "en", name: "English", native: true },
    ]);
    expect(fetchLanguages).not.toHaveBeenCalled();
  });

  it("doesn't fetch without a Wikidata id", async () => {
    await getPool().query("UPDATE personas SET wikidata_qid = NULL");
    const fetchLanguages = vi.fn(async () => PT);
    await languagesFor(await goulart(), { pool: getPool(), fetchLanguages });
    expect(fetchLanguages).not.toHaveBeenCalled();
  });

  it("falls back to English and stores nothing when the lookup fails or is slow", async () => {
    const quiet = vi.spyOn(console, "error").mockImplementation(() => {});
    const deps = { pool: getPool(), fetchLanguages: async () => Promise.reject(new Error("down")) };
    expect(await languagesFor(await goulart(), deps)).toEqual([{ code: "en", name: "English", native: true }]);
    const slow = { pool: getPool(), fetchLanguages: () => new Promise<typeof PT>((r) => setTimeout(() => r(PT), 500)) };
    const started = Date.now();
    expect(await languagesFor(await goulart(), slow, 50)).toEqual([{ code: "en", name: "English", native: true }]);
    expect(Date.now() - started).toBeLessThan(400);
    expect((await goulart()).storedLanguages).toBeNull();
    quiet.mockRestore();
  });

  it("never overwrites languages an ingest stored meanwhile", async () => {
    const stale = await goulart();
    await getPool().query(`UPDATE personas SET languages = '[{"code":"en","name":"English","native":true}]'::jsonb`);
    await languagesFor(stale, { pool: getPool(), fetchLanguages: async () => PT });
    expect((await goulart()).storedLanguages).toEqual([{ code: "en", name: "English", native: true }]);
  });
});
