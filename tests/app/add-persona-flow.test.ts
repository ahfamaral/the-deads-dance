import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import AddPersonaFlow, { FindForm, FoundPersona } from "@/components/add-persona-flow";
import type { FindResult, RoundEvent } from "@/lib/persona-profile";
import { streamRound } from "@/lib/round-client";

vi.mock("next/link", async () => {
  const { createElement } = await import("react");
  type Props = { href: string; children?: import("react").ReactNode };
  return { default: ({ href, children, ...rest }: Props) => createElement("a", { href, ...rest }, children) };
});
vi.mock("next/navigation", () => ({ useRouter: () => ({ replace: vi.fn(), push: vi.fn() }) }));

const FOUND: FindResult = {
  slug: "alberto-santos-dumont",
  name: "Alberto Santos-Dumont",
  description: "Brazilian aviation pioneer",
  lifespan: "1873–1932",
  languages: [
    { code: "pt", name: "Portuguese", native: true, source: "Wikidata" },
    { code: "fr", name: "French", native: false, source: "Wikidata" },
  ],
  editions: [
    { language: "en", title: "Alberto Santos-Dumont", words: 8_200, badge: null, estimated: 3_000, redraftEstimated: 2_000 },
    { language: "pt", title: "Alberto Santos Dumont", words: 14_900, badge: "featured", estimated: 4_000, redraftEstimated: 2_500 },
  ],
  compareEstimated: 3_000,
};

describe("AddPersonaFlow (spec §34.8)", () => {
  it("starts on find with the name from the URL, and Cancel goes to configure mode", () => {
    const html = renderToStaticMarkup(createElement(AddPersonaFlow, { initialTitle: "Santos-Dumont" }));
    expect(html).toContain("Add persona");
    expect(html).toContain('value="Santos-Dumont"');
    expect(html).toContain(">Find<");
    expect(html).toContain('href="/?manage=1"');
    expect(html).toContain(">Cancel<");
  });

  it("shows a find error under the field", () => {
    const html = renderToStaticMarkup(
      createElement(FindForm, { title: "Pelé", onTitle: () => {}, onFind: () => {}, finding: false, error: "Pelé is alive; only people who have died can be added." }),
    );
    const field = html.indexOf("<input");
    const error = html.indexOf("Pelé is alive");
    expect(field).toBeGreaterThan(-1);
    expect(error).toBeGreaterThan(field);
    expect(html).toContain('role="alert"');
  });

  it("shows who was found, the editions with word counts and the languages, then the priced compare", () => {
    const html = renderToStaticMarkup(createElement(FoundPersona, { found: FOUND, comparing: false, error: null, onCompare: () => {} }));
    expect(html).toContain("Alberto Santos-Dumont");
    expect(html).toContain("Brazilian aviation pioneer");
    expect(html).toContain("1873–1932");
    expect(html).toContain("14,900 words");
    expect(html).toContain("Portuguese");
    expect(html).toContain("Wikidata");
    expect(html).toContain("Compare editions · $0.003");
    expect(html.replace("Compare editions · $0.003", "")).not.toContain("·");
  });
});

describe("streamRound (spec §34.6)", () => {
  const ndjson = (events: RoundEvent[]) =>
    new Response(events.map((e) => JSON.stringify(e)).join("\n") + "\n", { headers: { "Content-Type": "application/x-ndjson" } });

  it("passes the streamed events on", async () => {
    const events: RoundEvent[] = [
      { type: "progress", label: "Fetching texts", status: "finished", spent: 0 },
      { type: "done", slug: "wu", cost: 4_000 },
    ];
    const fetchFn = vi.fn(async () => ndjson(events));
    const seen: RoundEvent[] = [];
    await streamRound({ slug: "wu", plan: {} as never }, (e) => seen.push(e), fetchFn as unknown as typeof fetch);
    expect(seen).toEqual(events);
    expect(fetchFn).toHaveBeenCalledWith("/api/admin/personas/rounds", expect.objectContaining({ method: "POST" }));
  });

  it("turns a refusal before streaming into an error event with its code", async () => {
    const fetchFn = async () => Response.json({ error: "A round is already running for this persona.", code: "round_running" }, { status: 409 });
    const seen: RoundEvent[] = [];
    await streamRound({ slug: "wu", plan: {} as never }, (e) => seen.push(e), fetchFn as unknown as typeof fetch);
    expect(seen).toEqual([{ type: "error", message: "A round is already running for this persona.", code: "round_running" }]);
  });

  it("reports a stream that stops before done, and an unreachable server", async () => {
    const cut = vi.fn(async () => ndjson([{ type: "progress", label: "Fetching texts", status: "started", spent: 0 }]));
    const seen: RoundEvent[] = [];
    await streamRound({ slug: "wu", plan: {} as never }, (e) => seen.push(e), cut as unknown as typeof fetch);
    expect(seen.at(-1)).toEqual({ type: "error", message: "The connection was lost. The round may still be running; the profile shows how it ended." });

    const down: RoundEvent[] = [];
    await streamRound({ slug: "wu", plan: {} as never }, (e) => down.push(e), (async () => { throw new TypeError("offline"); }) as unknown as typeof fetch);
    expect(down).toEqual([{ type: "error", message: "Couldn't reach the server." }]);
  });
});
