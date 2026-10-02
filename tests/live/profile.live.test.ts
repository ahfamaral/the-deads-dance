import { afterAll, describe, expect, it } from "vitest";
import { closePool, getPool } from "@corpus/db";
import { findPersona } from "@corpus/personas";
import { isKnown, PROFILE_FIELDS, profileGenerator, type ProfileField } from "@corpus/profile";
import { loadDevEnv } from "./live-env";

// Opt-in (`npm run test:live`): generates v2 profiles from the dev database's article text, storing nothing.
loadDevEnv();
afterAll(() => closePool());

const CURATED = ["albert-einstein", "george-washington-carver", "katherine-johnson", "chien-shiung-wu", "alberto-santos-dumont"];

describe("profile generator v2 (live)", () => {
  for (const slug of CURATED) {
    it(`drafts a checked profile for ${slug}`, async () => {
      const persona = await findPersona(getPool(), slug);
      if (!persona?.sourceText) throw new Error(`${slug} has no article text in the dev database — run npm run ingest.`);
      let dropped: ProfileField[] = [];
      const generate = profileGenerator({ onDropped: (fields) => (dropped = fields) });

      const started = Date.now();
      const profile = await generate(persona.sourceText);
      const seconds = (Date.now() - started) / 1000;

      console.log(`\n[${slug}] ${seconds.toFixed(1)} s, dropped by the checks: ${dropped.join(", ") || "none"}\n${JSON.stringify(profile, null, 2)}\n`);
      expect(PROFILE_FIELDS.filter((f) => isKnown(profile[f])).length).toBeGreaterThanOrEqual(3);
      expect(seconds).toBeLessThan(90);
    }, 120_000);
  }
});
