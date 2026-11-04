import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import IngestionHistory from "@/components/ingestion-history";
import PersonaProfile from "@/components/persona-profile";
import { addedBanner, profileBanner, reingestedBanner, type PersonaProfileDto, type RoundDto } from "@/lib/persona-profile";

vi.mock("next/link", async () => {
  const { createElement } = await import("react");
  type Props = { href: string; children?: import("react").ReactNode };
  return { default: ({ href, children, ...rest }: Props) => createElement("a", { href, ...rest }, children) };
});

const ID = "8f14e45f-ceea-467f-a0e6-2b8a2a6b1c11";
const item = (over: Partial<RoundDto["items"][number]> = {}) => ({ id: 1, action: "added" as const, label: "Portuguese article, 212 passages", passages: 212, estimated: 4000, cost: 4000, costEstimated: false, ...over });
const round = (over: Partial<RoundDto> = {}): RoundDto => ({
  id: 2, number: 2, status: "done", note: null, startedAt: "2026-10-22T09:00:00.000Z", finishedAt: "2026-10-22T09:02:00.000Z", cost: 16000, items: [item()], ...over,
});
const dto = (over: Partial<PersonaProfileDto> = {}): PersonaProfileDto => ({
  slug: "santos-dumont", name: "Alberto Santos-Dumont", description: "Brazilian aviation pioneer", lifespan: "1873 to 1932", origin: "user",
  highlights: "Born in Minas Gerais.\n\nFamous for the 14-bis.",
  profile: { temperament: "restless", humour: "unknown", passions: "flight", indifferences: "unknown", speech: "courtly", sore_points: "rivals" },
  languages: [
    { code: "pt", name: "Portuguese", native: true, source: "Wikidata" },
    { code: "en", name: "English", native: false, source: "none found, English assumed" },
  ],
  sources: [{ kind: "article", site: "wikipedia", language: "pt", title: "Alberto Santos-Dumont", revid: 70412233, url: "https://pt.wikipedia.org/wiki/Alberto_Santos-Dumont", passages: 212 }],
  rounds: [round(), round({ id: 1, number: 1, cost: null, items: [item({ cost: null })] })],
  spent: 19000, running: false, comparison: null,
  ratings: { summary: { count: 1, average: 4, perPersona: [] }, items: [{ conversationId: ID, stars: 4, comment: "Lovely", email: "ana@example.com", personaName: "Alberto Santos-Dumont", createdAt: "2026-10-23T10:00:00.000Z", edited: true }] },
  ...over,
});
const render = (d: PersonaProfileDto, extra: Record<string, unknown> = {}) =>
  renderToStaticMarkup(createElement(PersonaProfile, { slug: d.slug, initial: d, backHref: "/?open=" + ID, banner: null, offerVoice: false, ...extra }));

describe("PersonaProfile (spec §34.4)", () => {
  it("shows the sections in spec order", () => {
    const html = render(dto());
    const heads = ["Biography highlights", "Character", "Languages", "Memory sources", "Ingestion history", "Testers&#x27; ratings", "Change sources"];
    const at = heads.map((h) => html.indexOf(h));
    expect(at.every((i) => i >= 0)).toBe(true);
    expect([...at].sort((a, b) => a - b)).toEqual(at);
  });

  it("uses backHref for Back and has no dot-joined header", () => {
    const html = render(dto());
    expect(html).toContain(`href="/?open=${ID}"`);
    expect(html).not.toContain("·");
    expect(html).toContain("Brazilian aviation pioneer");
  });

  it("labels each language with its source and shows unknown traits as such", () => {
    const html = render(dto());
    expect(html).toContain("Wikidata");
    expect(html).toContain("none found, English assumed");
    expect(html).toContain("unknown");
  });

  it("lists sources with a link to the page", () => {
    const html = render(dto());
    expect(html).toContain("https://pt.wikipedia.org/wiki/Alberto_Santos-Dumont");
    expect(html).toContain("212 passages");
  });

  it("renders rounds with item costs, and cost not recorded when null", () => {
    const html = render(dto());
    expect(html).toContain("Round 2, 22 Oct 2026");
    expect(html).toContain("Spent on this memory so far: $0.019");
    expect(html).toContain("$0.016");
    expect(html).toContain("$0.004");
    expect(html).toContain("cost not recorded");
  });

  it("marks an estimated cost with about, on the item, its round and the total (final review, Minor 1)", () => {
    const estimated = round({ items: [item({ costEstimated: true }), item({ id: 3, action: "compared", label: "Compared editions", passages: null, cost: 500 })] });
    const html = renderToStaticMarkup(createElement(IngestionHistory, { rounds: [estimated, round({ id: 1, number: 1 })], spent: 20_500 }));
    expect(html).toContain("about $0.004");
    expect(html).toContain("about $0.016");
    expect(html).toContain("Spent on this memory so far: about $0.021");
    expect(html).not.toContain("about $0.0005");
    const exact = renderToStaticMarkup(createElement(IngestionHistory, { rounds: [round()], spent: 16_000 }));
    expect(exact).not.toContain("about");
  });

  it("shows the passage count once: on its own line only when the label lacks it (final review, Minor 2)", () => {
    const items = [
      item(),
      item({ id: 3, label: "Real quotes, 22 (replaced English)", passages: 22 }),
      item({ id: 4, label: "Mentions: Fluminense Football Club", passages: 1 }),
      item({ id: 5, label: "Mentions: Página apagada had nothing to add", passages: 0 }),
    ];
    const html = renderToStaticMarkup(createElement(IngestionHistory, { rounds: [round({ items })], spent: 0 }));
    expect(html.split("212 passages")).toHaveLength(2);
    expect(html).not.toContain("22 passages");
    expect(html).toContain("Mentions: Fluminense Football Club<span");
    expect(html).toContain(">1 passage</span>");
    expect(html).not.toContain("0 passages");
  });

  it("shows the draft note and the running note", () => {
    expect(render(dto({ rounds: [round({ status: "draft", note: "Compared, not ingested" })] }))).toContain("Compared, not ingested");
    expect(render(dto({ running: true, rounds: [round({ status: "running", note: "Reingest running", cost: null })] }))).toContain("Reingest running");
  });

  it("lists ratings with an Open link", () => {
    const html = render(dto());
    expect(html).toContain(`href="/?open=${ID}"`);
    expect(html).toContain("ana@example.com");
    expect(html).toContain("edited");
    expect(render(dto({ ratings: { summary: { count: 0, average: null, perPersona: [] }, items: [] } }))).toContain("No ratings yet.");
  });

  it("shows banners and the voice offer", () => {
    expect(render(dto(), { banner: "Reingested, cost $0.011" })).toContain("Reingested, cost $0.011");
    const html = render(dto(), { offerVoice: true });
    expect(html).toContain("Create a voice for Alberto Santos-Dumont?");
    expect(html).toContain("Create voice");
    expect(html).toContain("Not now");
    expect(render(dto())).not.toContain("Create voice");
  });

  it("says about in the banners when the round's cost includes an estimated call (follow-up 2)", () => {
    expect(addedBanner("Alberto Santos-Dumont", 16_000, true)).toBe("Alberto Santos-Dumont added, cost about $0.016");
    expect(addedBanner("Alberto Santos-Dumont", 16_000, false)).toBe("Alberto Santos-Dumont added, cost $0.016");
    expect(reingestedBanner(11_000, true)).toBe("Reingested, cost about $0.011");
    expect(reingestedBanner(11_000, false)).toBe("Reingested, cost $0.011");
  });

  it("words the page's banner from its query, estimated when the latest finished round is (follow-up 2)", () => {
    const estimated = dto({ rounds: [round({ status: "draft", items: [] }), round({ id: 1, items: [item({ costEstimated: true })] })] });
    expect(profileBanner(estimated, { added: "16000" })).toBe("Alberto Santos-Dumont added, cost about $0.016");
    expect(profileBanner(estimated, { reingested: "11000" })).toBe("Reingested, cost about $0.011");
    expect(profileBanner(dto(), { added: "16000" })).toBe("Alberto Santos-Dumont added, cost $0.016");
    expect(profileBanner(dto(), { reingested: "11000" })).toBe("Reingested, cost $0.011");
    expect(profileBanner(dto(), { added: "lots" })).toBeNull();
    expect(profileBanner(dto(), {})).toBeNull();
  });

  it("has Edit and Redraft for highlights, and says so when there are none", () => {
    const html = render(dto());
    expect(html).toContain(">Edit<");
    expect(html).toContain(">Redraft<");
    expect(render(dto({ highlights: null }))).toContain("No highlights yet.");
  });
});
