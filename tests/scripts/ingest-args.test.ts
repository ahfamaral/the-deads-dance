import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { parseIngestArgs, parseManifest, selectEntries } from "../../scripts/ingest-args";

describe("parseIngestArgs", () => {
  it("defaults to all personas, no refresh", () => {
    expect(parseIngestArgs([])).toEqual({ refresh: false, only: [] });
  });

  it("reads --refresh and slugs", () => {
    expect(parseIngestArgs(["--refresh", "chien-shiung-wu"])).toEqual({ refresh: true, only: ["chien-shiung-wu"] });
  });
});

describe("parseManifest", () => {
  it("parses the real personas.json into five curated entries", () => {
    const entries = parseManifest(JSON.parse(readFileSync("personas.json", "utf8")));
    expect(entries.map((e) => e.slug)).toEqual([
      "albert-einstein",
      "george-washington-carver",
      "katherine-johnson",
      "chien-shiung-wu",
      "alberto-santos-dumont",
    ]);
    expect(entries.every((e) => e.origin === "curated")).toBe(true);
  });

  it("rejects a non-array, a missing field and a duplicate slug", () => {
    expect(() => parseManifest({})).toThrow(/array/);
    expect(() => parseManifest([{ slug: "x" }])).toThrow(/entry 0.*wikipediaTitle/);
    expect(() =>
      parseManifest([
        { slug: "x", wikipediaTitle: "X" },
        { slug: "x", wikipediaTitle: "Y" },
      ]),
    ).toThrow(/duplicate slug "x"/);
  });

  const pinned = {
    temperament: "Patient, modest",
    humour: "unknown",
    passions: "Soil and peanuts",
    indifferences: "Money and fame",
    speech: "Plain, gentle",
    sore_points: "unknown",
  };

  it("reads a pinned profile", () => {
    const [entry] = parseManifest([{ slug: "x", wikipediaTitle: "X", profile: pinned }]);
    expect(entry.profile).toEqual(pinned);
  });

  it("rejects a pinned profile with an unknown field or an over-long value, naming the entry", () => {
    expect(() => parseManifest([{ slug: "x", wikipediaTitle: "X", profile: { ...pinned, humor: "typo" } }])).toThrow(
      /entry 0.*profile/,
    );
    expect(() =>
      parseManifest([{ slug: "x", wikipediaTitle: "X", profile: { ...pinned, speech: "a".repeat(161) } }]),
    ).toThrow(/entry 0.*profile.*speech/);
  });

  it("no longer accepts systemPrompt", () => {
    expect(() => parseManifest([{ slug: "x", wikipediaTitle: "X", systemPrompt: "Old voice notes" }])).toThrow(
      /entry 0.*systemPrompt.*profile/,
    );
  });

  it("accepts and normalises a pinned language list", () => {
    const [entry] = parseManifest([
      {
        slug: "x",
        wikipediaTitle: "X",
        languages: [
          { code: "en", name: "English", native: false },
          { code: "de", name: "German", native: true },
        ],
      },
    ]);
    expect(entry.languages).toEqual([
      { code: "de", name: "German", native: true },
      { code: "en", name: "English", native: false },
    ]);
  });

  it("rejects an invalid pinned language list", () => {
    expect(() => parseManifest([{ slug: "x", wikipediaTitle: "X", languages: [{ code: "German" }] }])).toThrow(
      /entry 0: "languages" is invalid/,
    );
  });
});

describe("selectEntries", () => {
  const entries = parseManifest([
    { slug: "a", wikipediaTitle: "A" },
    { slug: "b", wikipediaTitle: "B" },
  ]);

  it("returns everything when no slugs are given", () => {
    expect(selectEntries(entries, [])).toHaveLength(2);
  });

  it("filters to the given slugs and rejects unknown ones", () => {
    expect(selectEntries(entries, ["b"]).map((e) => e.slug)).toEqual(["b"]);
    expect(() => selectEntries(entries, ["zzz"])).toThrow(/Unknown persona slug.*zzz.*Known: a, b/);
  });
});
