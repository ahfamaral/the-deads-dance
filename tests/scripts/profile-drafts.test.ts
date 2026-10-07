import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import { closePool, getPool } from "../../corpus/db";
import type { CharacterProfile } from "../../corpus/profile";
import { draftProfiles } from "../../scripts/profile-drafts";
import { insertPersona, resetDb } from "../helpers/db";

const PROFILE: CharacterProfile = {
  temperament: "Patient, modest",
  humour: "unknown",
  passions: "Soil and peanuts",
  indifferences: "Money and fame",
  speech: "Plain, gentle",
  sore_points: "unknown",
};

beforeEach(() => resetDb());
afterAll(() => closePool());

describe("draftProfiles", () => {
  it("drafts from stored article text and writes nothing", async () => {
    await insertPersona({ slug: "carver", sourceText: "George Washington Carver was an agricultural scientist." });
    const generateProfile = vi.fn(async () => PROFILE);

    const result = await draftProfiles(["carver"], { pool: getPool(), generateProfile });

    expect(result).toEqual({ profiles: { carver: PROFILE }, failures: [] });
    expect(generateProfile).toHaveBeenCalledWith("George Washington Carver was an agricultural scientist.");
    const { rows } = await getPool().query("SELECT profile FROM personas WHERE slug = 'carver'");
    expect(rows[0].profile).toBeNull();
  });

  it("reports personas that aren't ingested or whose generation fails, and carries on", async () => {
    await insertPersona({ slug: "no-text", sourceText: null });
    await insertPersona({ slug: "broken", sourceText: "Text." });
    await insertPersona({ slug: "fine", sourceText: "Text." });
    let calls = 0;
    const generateProfile = vi.fn(async () => {
      calls++;
      if (calls === 1) throw new Error("helper model down"); // "broken" is the first persona with text
      return PROFILE;
    });

    const result = await draftProfiles(["missing", "no-text", "broken", "fine"], { pool: getPool(), generateProfile });

    expect(Object.keys(result.profiles)).toEqual(["fine"]);
    expect(result.failures).toEqual([
      "missing: not in the database — load the personas first (make db-seed)",
      "no-text: not in the database — load the personas first (make db-seed)",
      "broken: helper model down",
    ]);
  });
});
