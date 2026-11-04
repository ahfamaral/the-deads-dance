import { describe, expect, it } from "vitest";
import {
  extractQuotes,
  linkScore,
  listLinked,
  listMentions,
  listQuotes,
  listWritings,
  mentionNames,
  nameVariants,
  paragraphsNaming,
} from "../../corpus/extras";
import { WikipediaError, type Sitelink, type WikimediaClient } from "../../corpus/wikimedia";

const pt = { site: "wikipedia", language: "pt" } as const;
const FLUMINENSE =
  "um grande destaque nos anos iniciais deste esporte foi o grande aviador e inventor brasileiro Santos Dumont, associado honorário nº 11 do Tricolor, que durante anos frequentou o clube, sendo árbitro em vários jogos de tênis.";
const NAMES = ["Alberto Santos-Dumont", "Santos Dumont"];

type Fake = Partial<{
  links: Record<string, string[]>;
  backlinks: string[];
  search: Record<string, string[]>;
  pages: Record<string, string>;
  lengths: Record<string, number>;
}>;
function fakeClient(f: Fake = {}): WikimediaClient {
  return {
    getJson: async () => ({}),
    extract: async (_ref, title) => {
      if (!(title in (f.pages ?? {}))) throw new WikipediaError("not_found", "no");
      return { title, revid: 1, qid: null, text: f.pages![title] };
    },
    sitelinks: async () => [],
    links: async (_ref, title) => f.links?.[title] ?? [],
    backlinks: async () => f.backlinks ?? [],
    search: async (_ref, phrase) => f.search?.[phrase] ?? [],
    pageLengths: async (_ref, titles) => new Map(titles.flatMap((t) => (t in (f.lengths ?? {}) ? [[t, f.lengths![t]] as [string, number]] : []))),
  };
}

describe("extractQuotes", () => {
  const page = [
    "Lead line that is long enough to be a quote but sits in the lead.",
    "== Citações ==",
    "O homem voa como o pássaro, e isso muda tudo no mundo.",
    "curta",
    "O homem voa como o pássaro, e isso muda tudo no mundo.",
    "=== Cartas ===",
    "Escrevi isto numa carta, e ainda penso o mesmo hoje.",
    "== Atribuídas ==",
    "Uma frase que ele nunca disse, mas que todos repetem.",
    "== Citações sobre Santos Dumont ==",
    "Um elogio de outra pessoa que não é dele, claramente.",
  ].join("\n");

  it("keeps only the real sections, drops short lines, dedupes", () => {
    expect(extractQuotes(page, "pt")).toEqual([
      "O homem voa como o pássaro, e isso muda tudo no mundo.",
      "Escrevi isto numa carta, e ainda penso o mesmo hoje.",
    ]);
  });

  it("drops lines over 600 chars", () => {
    expect(extractQuotes(`== Quotes ==\n${"x".repeat(601)}\n${"y".repeat(600)}`, "en")).toEqual(["y".repeat(600)]);
  });
});

describe("paragraphsNaming", () => {
  it("finds the Fluminense paragraph by either name", () => {
    const text = `Lead sem nome.\n== História ==\n${FLUMINENSE}`;
    expect(paragraphsNaming(text, NAMES)).toEqual([FLUMINENSE]);
  });

  it("matches lowercase and hyphenated forms, not a bare surname", () => {
    expect(paragraphsNaming("conheci santos dumont ontem", NAMES)).toHaveLength(1);
    expect(paragraphsNaming("O aviador Santos-Dumont voou.", NAMES)).toHaveLength(1);
    expect(paragraphsNaming("O bairro de Santos fica no litoral.", NAMES)).toEqual([]);
    expect(paragraphsNaming("Os Santos Dumontianos", NAMES)).toEqual([]);
  });

  it("ignores accents, skips headings, and returns at most 3", () => {
    expect(paragraphsNaming("== Santos Dumont ==", NAMES)).toEqual([]);
    expect(paragraphsNaming("José Álvaro disse.", ["Jose Alvaro"])).toHaveLength(1);
    expect(paragraphsNaming(Array(5).fill("Santos Dumont voou.").join("\n"), NAMES)).toHaveLength(3);
  });
});

describe("nameVariants and linkScore", () => {
  it("swaps hyphens and spaces", () => {
    expect(nameVariants(["Santos-Dumont"])).toEqual(["Santos-Dumont", "Santos Dumont"]);
  });

  it("counts occurrences and adds 3 for the lead", () => {
    const text = "Paris é bela. Paris.\n== Vida ==\nParis e Roma. Roma.";
    expect(linkScore(text, "Paris")).toBe(3 + 3);
    expect(linkScore(text, "Roma")).toBe(2);
  });
});

describe("mentionNames (spec §34.5)", () => {
  const links: Sitelink[] = [
    { site: "wikipedia", language: "en", title: "Alberto Santos-Dumont", badges: [] },
    { site: "wikiquote", language: "pt", title: "Alberto Santos Dumont", badges: [] },
    { site: "wikipedia", language: "pt", title: "Santos Dumont", badges: [] },
  ];

  it("adds that language's Wikipedia title to the persona's names, once", () => {
    expect(mentionNames(["Alberto Santos-Dumont"], links, "pt")).toEqual(["Alberto Santos-Dumont", "Santos Dumont"]);
    expect(mentionNames(["Alberto Santos-Dumont"], links, "en")).toEqual(["Alberto Santos-Dumont"]);
    expect(mentionNames(["Alberto Santos-Dumont"], links, "fr")).toEqual(["Alberto Santos-Dumont"]);
  });
});

describe("listWritings and listQuotes", () => {
  const sitelinks: Sitelink[] = [
    { site: "wikisource", language: "pt", title: "Autor:Alberto Santos-Dumont", badges: [] },
    { site: "wikiquote", language: "pt", title: "Alberto Santos-Dumont", badges: [] },
    { site: "wikipedia", language: "pt", title: "Alberto Santos-Dumont", badges: [] },
  ];

  it("lists the author page's links with their lengths, looked up by link title", async () => {
    const client = fakeClient({
      links: { "Autor:Alberto Santos-Dumont": ["Dans l'air", "Sem tamanho"] },
      lengths: { "Dans l'air": 5000 },
    });
    expect(await listWritings(client, sitelinks)).toEqual([
      { kind: "writing", site: "wikisource", language: "pt", title: "Dans l'air", chars: 5000 },
    ]);
  });

  it("makes one quotes candidate per Wikiquote page", async () => {
    const quote = "O homem voa como o pássaro, e isso muda tudo.";
    const client = fakeClient({ pages: { "Alberto Santos-Dumont": `Lead\n== Citações ==\n${quote}\ncurta` } });
    expect(await listQuotes(client, sitelinks)).toEqual([
      { kind: "quotes", site: "wikiquote", language: "pt", title: "Alberto Santos-Dumont", chars: quote.length, count: 1 },
    ]);
  });
});

describe("listLinked", () => {
  it("drops years, dates and lists, and ranks by score", async () => {
    const client = fakeClient({
      links: { Art: ["1906", "23 de outubro", "Lista de aviadores", "List of things", "Rara", "Paris", "Art"] },
      lengths: { Rara: 10, Paris: 20 },
    });
    const result = await listLinked(client, pt, "Art", "Paris, Paris.\n== A ==\nRara.");
    expect(result.map((c) => [c.title, c.chars])).toEqual([["Paris", 20], ["Rara", 10]]);
    expect(result[0]).toMatchObject({ kind: "linked", site: "wikipedia", language: "pt" });
  });

  it("keeps at most 50", async () => {
    const titles = Array.from({ length: 80 }, (_, i) => `T${i}`);
    const client = fakeClient({ links: { Art: titles }, lengths: Object.fromEntries(titles.map((t) => [t, 1])) });
    expect(await listLinked(client, pt, "Art", "")).toHaveLength(50);
  });
});

describe("listMentions", () => {
  const client = fakeClient({
    backlinks: ["Alberto Santos-Dumont", "Fluminense", "Só link", "Outro"],
    search: { "Alberto Santos-Dumont": ["Aviação", "Fluminense"], "Santos Dumont": ["Aviação", "Sem nome"] },
    pages: {
      Fluminense: `Clube.\n${FLUMINENSE}`,
      Aviação: "Santos Dumont voou.",
      "Sem nome": "Nada aqui.",
      "Só link": "O aviador Santos-Dumont.",
      Outro: "Sem menção.",
    },
  });

  it("orders pages in both lists first, skips the persona and pages with no naming paragraph", async () => {
    const { items, total } = await listMentions(client, pt, "Alberto Santos-Dumont", NAMES, 0, 20);
    expect(items.map((i) => i.title)).toEqual(["Fluminense", "Aviação", "Só link"]);
    expect(total).toBe(5);
    expect(items[0]).toMatchObject({ kind: "mention", preview: FLUMINENSE, chars: FLUMINENSE.length });
  });

  it("reads only the requested window", async () => {
    const { items, total } = await listMentions(client, pt, "Alberto Santos-Dumont", NAMES, 1, 1);
    expect(items.map((i) => i.title)).toEqual(["Aviação"]);
    expect(total).toBe(5);
  });
});
