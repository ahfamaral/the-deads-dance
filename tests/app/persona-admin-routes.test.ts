import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import { CostLedger, meteredEmbeddings } from "@corpus/cost-ledger";
import { closePool, getPool } from "@corpus/db";
import { EMBEDDING_MODEL } from "@corpus/embeddings";
import { embeddingEstimate, redraftEstimate } from "@corpus/estimate";
import { listRounds, startRound } from "@corpus/rounds";
import { WikipediaError, type Article, type Sitelink, type WikiRef, type WikimediaClient } from "@corpus/wikimedia";
import { readNdjson } from "@/lib/ndjson";
import type { CandidatesResult, CompareResult, FindResult, PersonaProfileDto, RoundEvent } from "@/lib/persona-profile";
import type { SourcePlan } from "@corpus/plan-changes";
import { article, paragraph } from "../fixtures/articles";
import { FakeEmbeddings } from "../helpers/fake-embeddings";
import { insertPersona, resetAuth, resetDb } from "../helpers/db";
import { signInAs } from "../helpers/auth";

const fakes = vi.hoisted(() => ({ admin: null as unknown, round: null as unknown }));
vi.mock("@/lib/server/persona-admin", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/server/persona-admin")>();
  return {
    ...actual,
    adminDeps: () => fakes.admin,
    // The real onItemCalls (resolve, record, set the cost); fake Wikimedia, embeddings and drafters.
    roundDeps: (adminId: string, slug: string) => ({ ...actual.roundDeps(adminId, slug), ...(fakes.round as object) }),
  };
});

const profileRoute = await import("@/app/api/admin/personas/[slug]/route");
const findRoute = await import("@/app/api/admin/personas/find/route");
const compareRoute = await import("@/app/api/admin/personas/compare/route");
const candidatesRoute = await import("@/app/api/admin/personas/candidates/route");
const roundsRoute = await import("@/app/api/admin/personas/rounds/route");

const pool = () => getPool();
const PT_TEXT = `Wu Chien-Shiung foi uma física experimental. ${paragraph("Resumo", 30)}`;
const QUOTES_TEXT = [
  "Chien-Shiung Wu was a physicist.",
  "",
  "== Quotes ==",
  "It is the courage to doubt what has long been established.",
  "There is only one thing worse than coming home from the lab to a sink full of dirty dishes.",
].join("\n");
const MENTION_TEXT = "Columbia is a university.\nIn 1956 Chien-Shiung Wu showed parity violation at Columbia.";

const pageKey = (ref: WikiRef, title: string) => `${ref.site}:${ref.language}:${title}`;
const PAGES: Record<string, Article> = {
  "wikipedia:en:Chien-Shiung Wu": article(),
  "wikipedia:pt:Wu Chien-Shiung": { title: "Wu Chien-Shiung", revid: 555, qid: "Q450317", text: PT_TEXT },
  "wikiquote:en:Chien-Shiung Wu": { title: "Chien-Shiung Wu", revid: 66, qid: null, text: QUOTES_TEXT },
  "wikipedia:en:Columbia University": { title: "Columbia University", revid: 77, qid: null, text: MENTION_TEXT },
  "wikipedia:en:Huge": { title: "Huge", revid: 88, qid: null, text: "x ".repeat(150_001) },
};
const SITELINKS: Sitelink[] = [
  { site: "wikipedia", language: "en", title: "Chien-Shiung Wu", badges: [] },
  { site: "wikipedia", language: "pt", title: "Wu Chien-Shiung", badges: ["good"] },
  { site: "wikiquote", language: "en", title: "Chien-Shiung Wu", badges: [] },
];

function fakeClient() {
  const extract = vi.fn(async (ref: WikiRef, title: string): Promise<Article> => {
    const page = PAGES[pageKey(ref, title)];
    if (!page) throw new WikipediaError("not_found", `No page "${title}".`);
    return page;
  });
  const client: WikimediaClient = {
    extract,
    getJson: async () => ({}),
    sitelinks: vi.fn(async () => SITELINKS),
    links: vi.fn(async () => ["Manhattan Project", "1956", "Columbia University"]),
    pageLengths: vi.fn(async (_ref: WikiRef, titles: string[]) => new Map(titles.map((t) => [t, 4_000]))),
    backlinks: vi.fn(async () => ["Columbia University"]),
    search: vi.fn(async () => []),
  };
  return { client, extract };
}

const PROFILE = { temperament: "Exacting", humour: "unknown", passions: "Beta decay", indifferences: "unknown", speech: "Precise", sore_points: "unknown" };

let wiki: ReturnType<typeof fakeClient>;
let embedder: FakeEmbeddings;
let scored: number;
let cookie = "";
let adminId = "";
let wuId = 0;

beforeEach(async () => {
  await resetDb();
  await resetAuth();
  await pool().query("TRUNCATE ingest_rounds RESTART IDENTITY CASCADE");
  ({ cookie, userId: adminId } = await signInAs("boss@example.com", { role: "admin" }));
  wuId = await insertPersona({ slug: "wu", displayName: "Chien-Shiung Wu", origin: "user", wikidataQid: "Q450317" });
  await pool().query(
    `UPDATE personas SET languages = '[{"code":"pt","name":"Portuguese","native":false}]'::jsonb, languages_source = 'wikidata' WHERE id = $1`,
    [wuId],
  );
  wiki = fakeClient();
  embedder = new FakeEmbeddings();
  scored = 0;
  fakes.admin = {
    pool: pool(),
    client: wiki.client,
    prepare: {
      pool: pool(),
      fetchArticle: vi.fn(async () => article()),
      fetchPersonFacts: vi.fn(async () => ({ isHuman: true, isDeceased: true, description: "Physicist", lifespan: "1912–1997" })),
    },
    fetchLanguages: vi.fn(async () => [{ code: "pt", name: "Portuguese", native: false }]),
    scoreEditions: (ledger: CostLedger) => async (text: string) => {
      scored += 1;
      ledger.record({ role: "ingest", model: "helper/m", inputTokens: 100, outputTokens: 10, cost: 250, generationId: null, latencyMs: 1 });
      return text.startsWith("Wu Chien-Shiung") ? [0, 1, 2, 3] : [0, 1];
    },
    helperPrice: async () => ({ prompt: 0.1, completion: 0.4 }),
  };
  fakes.round = {
    client: wiki.client,
    embeddings: (ledger: CostLedger) => meteredEmbeddings(embedder, ledger, EMBEDDING_MODEL),
    generateProfile: () => async () => PROFILE,
    draftHighlights: () => async () => "Born in Liuhe.",
    fetchLanguages: async () => [],
  };
});
afterAll(() => closePool());

const json = (method: string, body: unknown, who = cookie) => ({
  method,
  headers: { "Content-Type": "application/json", cookie: who },
  body: JSON.stringify(body),
});
const slugCtx = (slug: string) => ({ params: Promise.resolve({ slug }) });

const getProfile = (slug: string, who = cookie) =>
  profileRoute.GET(new Request(`http://localhost/api/admin/personas/${slug}`, { headers: { cookie: who } }), slugCtx(slug));
const patchProfile = (slug: string, body: unknown, who = cookie) =>
  profileRoute.PATCH(new Request(`http://localhost/api/admin/personas/${slug}`, json("PATCH", body, who)), slugCtx(slug));
const find = (body: unknown, who = cookie) => findRoute.POST(new Request("http://localhost/api/admin/personas/find", json("POST", body, who)));
const compare = (body: unknown, who = cookie) => compareRoute.POST(new Request("http://localhost/api/admin/personas/compare", json("POST", body, who)));
const candidates = (query: string, who = cookie) =>
  candidatesRoute.GET(new Request(`http://localhost/api/admin/personas/candidates?${query}`, { headers: { cookie: who } }));
const rounds = (body: unknown, who = cookie) => roundsRoute.POST(new Request("http://localhost/api/admin/personas/rounds", json("POST", body, who)));

async function events(res: Response): Promise<RoundEvent[]> {
  const out: RoundEvent[] = [];
  for await (const e of readNdjson<RoundEvent>(res.body!)) out.push(e);
  return out;
}

const EN_PLAN: SourcePlan = {
  article: { kind: "article", site: "wikipedia", language: "en", title: "Chien-Shiung Wu" },
  extras: [],
  articleEstimated: 50,
  redraft: false,
  redraftEstimated: 0,
};

describe("admin persona routes answer 404 to everyone but the admin (spec §34.9)", () => {
  const calls: [string, (who: string) => Promise<Response>][] = [
    ["GET profile", (who) => getProfile("wu", who)],
    ["PATCH profile", (who) => patchProfile("wu", { highlights: "Hi" }, who)],
    ["find", (who) => find({ title: "Chien-Shiung Wu" }, who)],
    ["compare", (who) => compare({ slug: "wu" }, who)],
    ["candidates", (who) => candidates("kind=quotes&slug=wu&language=en", who)],
    ["rounds", (who) => rounds({ slug: "wu", plan: EN_PLAN }, who)],
  ];
  it.each(calls)("%s: a tester and a signed-out caller get 404, and nothing is fetched", async (_name, call) => {
    const tester = await signInAs("t@example.com", { status: "approved" });
    expect((await call(tester.cookie)).status).toBe(404);
    expect((await call("")).status).toBe(404);
    expect(wiki.extract).not.toHaveBeenCalled();
    expect(scored).toBe(0);
    const { rows } = await pool().query(`SELECT highlights FROM personas WHERE slug = 'wu'`);
    expect(rows[0].highlights).toBeNull();
  });
});

describe("GET and PATCH /api/admin/personas/[slug] (spec §34.4)", () => {
  it("returns the profile", async () => {
    const res = await getProfile("wu");
    expect(res.status).toBe(200);
    const dto = (await res.json()) as PersonaProfileDto;
    expect(dto).toMatchObject({ slug: "wu", name: "Chien-Shiung Wu", languages: [{ code: "pt", source: "Wikidata" }], running: false, spent: 0 });
  });

  it("answers 404 for an unknown slug", async () => {
    expect((await getProfile("nobody")).status).toBe(404);
    expect((await patchProfile("nobody", { highlights: "Text" })).status).toBe(404);
  });

  it("saves edited highlights with 204", async () => {
    const res = await patchProfile("wu", { highlights: "  Born in Liuhe.  " });
    expect(res.status).toBe(204);
    const { rows } = await pool().query(`SELECT highlights FROM personas WHERE slug = 'wu'`);
    expect(rows[0].highlights).toBe("Born in Liuhe.");
  });

  it("rejects 1,501 characters, an empty text or a malformed body with 400", async () => {
    expect((await patchProfile("wu", { highlights: "a".repeat(1_501) })).status).toBe(400);
    expect((await patchProfile("wu", { highlights: "  " })).status).toBe(400);
    expect((await patchProfile("wu", { text: "Hi" })).status).toBe(400);
    const { rows } = await pool().query(`SELECT highlights FROM personas WHERE slug = 'wu'`);
    expect(rows[0].highlights).toBeNull();
  });
});

describe("POST /api/admin/personas/find (spec §34.3)", () => {
  it("lists the editions and the comparison's estimate, free", async () => {
    const res = await find({ title: "Chien-Shiung Wu" });
    expect(res.status).toBe(200);
    const body = (await res.json()) as FindResult;
    expect(body).toMatchObject({
      slug: "chien-shiung-wu",
      name: "Chien-Shiung Wu",
      description: "Physicist",
      lifespan: "1912–1997",
      languages: [{ code: "pt", name: "Portuguese", native: false, source: "Wikidata" }],
    });
    expect(body.editions.map((e) => [e.language, e.title, e.badge])).toEqual([["en", "Chien-Shiung Wu", null], ["pt", "Wu Chien-Shiung", "good"]]);
    expect(body.editions[0]).not.toHaveProperty("answered");
    expect(body.editions[0]).not.toHaveProperty("text");
    expect(body.compareEstimated).toBeGreaterThan(0);
    expect(scored).toBe(0);
  });

  it("refuses a living person with 422 not_deceased", async () => {
    (fakes.admin as { prepare: { fetchPersonFacts: unknown } }).prepare.fetchPersonFacts = vi.fn(async () => ({
      isHuman: true, isDeceased: false, description: "Singer", lifespan: "born 1980",
    }));
    const res = await find({ title: "Chien-Shiung Wu" });
    expect(res.status).toBe(422);
    expect((await res.json()).code).toBe("not_deceased");
  });

  it("refuses a persona already in the list with 409", async () => {
    await insertPersona({ slug: "chien-shiung-wu", displayName: "Chien-Shiung Wu", origin: "user" });
    const res = await find({ title: "Chien-Shiung Wu" });
    expect(res.status).toBe(409);
    expect((await res.json()).code).toBe("conflict");
  });

  it("rejects a body without a title with 400", async () => {
    expect((await find({})).status).toBe(400);
  });

  it("prices each edition: its embedding and a redraft from its text", async () => {
    const body = (await (await find({ title: "Chien-Shiung Wu" })).json()) as FindResult;
    const pt = body.editions.find((e) => e.language === "pt")!;
    expect(pt.estimated).toBe(embeddingEstimate(PT_TEXT.length));
    expect(pt.redraftEstimated).toBe(redraftEstimate({ prompt: 0.1, completion: 0.4 }, PT_TEXT.length));
    expect(pt.redraftEstimated).toBeGreaterThan(0);
  });

  it("lists an existing persona's editions by slug: no 409, no paid call, no add checks", async () => {
    const res = await find({ slug: "wu" });
    expect(res.status).toBe(200);
    const body = (await res.json()) as FindResult;
    expect(body).toMatchObject({ slug: "wu", name: "Chien-Shiung Wu", languages: [{ code: "pt", name: "Portuguese", native: false, source: "Wikidata" }] });
    expect(body.editions.map((e) => e.language)).toEqual(["en", "pt"]);
    expect(body.editions.every((e) => e.estimated > 0 && e.redraftEstimated > 0)).toBe(true);
    expect(body.compareEstimated).toBeGreaterThan(0);
    expect(scored).toBe(0);
    expect((fakes.admin as { prepare: { fetchArticle: ReturnType<typeof vi.fn> } }).prepare.fetchArticle).not.toHaveBeenCalled();
  });

  it("accepts a curated persona by slug", async () => {
    await insertPersona({ slug: "curie", displayName: "Marie Curie", origin: "curated", wikidataQid: "Q450317" });
    expect((await find({ slug: "curie" })).status).toBe(200);
  });

  it("answers 404 for an unknown slug and 422 for a persona without Wikidata", async () => {
    expect((await find({ slug: "nobody" })).status).toBe(404);
    await insertPersona({ slug: "plain", displayName: "Plain", origin: "curated" });
    const res = await find({ slug: "plain" });
    expect(res.status).toBe(422);
    expect((await res.json()).code).toBe("no_wikidata");
  });

  it("prices a redraft at 0 when the helper's price is unknown, as the comparison", async () => {
    (fakes.admin as { helperPrice: unknown }).helperPrice = async () => null;
    const body = (await (await find({ slug: "wu" })).json()) as FindResult;
    expect(body.editions.map((e) => e.redraftEstimated)).toEqual([0, 0]);
    expect(body.compareEstimated).toBe(0);
  });
});

describe("POST /api/admin/personas/compare (spec §34.3)", () => {
  it("scores the editions, best first, and keeps them on the persona's draft round", async () => {
    const res = await compare({ slug: "wu" });
    expect(res.status).toBe(200);
    const body = (await res.json()) as CompareResult;
    expect(body.scores.map((s) => [s.language, s.answered, s.total])).toEqual([["pt", 4, 30], ["en", 2, 30]]);
    expect(body.cost).toBe(500);

    const [draft] = await listRounds(pool(), "wu");
    expect(draft).toMatchObject({ number: 1, status: "draft", comparison: body.scores });
    expect(draft.items).toEqual([{ id: expect.any(Number), action: "compared", label: "Compared editions", passages: null, estimated: expect.any(Number), cost: 500, costEstimated: false }]);
    const { rows } = await pool().query(`SELECT user_id, persona_slug, ingest_item_id FROM model_calls`);
    expect(rows).toEqual([
      { user_id: adminId, persona_slug: "wu", ingest_item_id: draft.items[0].id },
      { user_id: adminId, persona_slug: "wu", ingest_item_id: draft.items[0].id },
    ]);
  });

  it("adds a second compared item to the same draft on a second compare", async () => {
    await compare({ slug: "wu" });
    await compare({ slug: "wu" });
    const all = await listRounds(pool(), "wu");
    expect(all).toHaveLength(1);
    expect(all[0].items.map((i) => i.action)).toEqual(["compared", "compared"]);
  });

  it("keys a new persona's draft by its slug", async () => {
    const res = await compare({ title: "Chien-Shiung Wu" });
    expect(res.status).toBe(200);
    expect((await listRounds(pool(), "chien-shiung-wu"))[0]).toMatchObject({ status: "draft" });
  });

  it("answers 404 for an unknown slug, before any model call", async () => {
    expect((await compare({ slug: "nobody" })).status).toBe(404);
    expect(scored).toBe(0);
  });

  it("still records the paid scoring calls when saving the comparison fails (final review, Important 2)", async () => {
    const real = pool();
    // Saving the scores fails; everything else goes to the real pool.
    fakes.admin = {
      ...(fakes.admin as object),
      pool: new Proxy(real, {
        get(target, prop) {
          if (prop === "query") {
            return (sql: unknown, ...rest: unknown[]) => {
              if (typeof sql === "string" && sql.includes("SET comparison")) return Promise.reject(new Error("connection lost"));
              return (target.query as (...a: unknown[]) => unknown).call(target, sql, ...rest);
            };
          }
          const value = Reflect.get(target, prop);
          return typeof value === "function" ? value.bind(target) : value;
        },
      }),
    };
    const errors = vi.spyOn(console, "error").mockImplementation(() => {});

    const res = await compare({ slug: "wu" });

    expect(res.status).toBe(503);
    expect(scored).toBe(2);
    const { rows } = await pool().query(`SELECT user_id, persona_slug, cost::int AS cost, ingest_item_id FROM model_calls ORDER BY id`);
    expect(rows).toEqual([
      { user_id: adminId, persona_slug: "wu", cost: 250, ingest_item_id: null },
      { user_id: adminId, persona_slug: "wu", cost: 250, ingest_item_id: null },
    ]);
    errors.mockRestore();
  });

  it("refuses a body that isn't JSON with 415, before any model call", async () => {
    const res = await compareRoute.POST(
      new Request("http://localhost/api/admin/personas/compare", {
        method: "POST",
        headers: { "Content-Type": "text/plain", cookie },
        body: JSON.stringify({ slug: "wu" }),
      }),
    );
    expect(res.status).toBe(415);
    expect(scored).toBe(0);
  });

  it("allows the function limit a comparison of four editions needs", () => {
    expect(compareRoute.maxDuration).toBe(300);
  });
});

describe("GET /api/admin/personas/candidates (spec §34.5)", () => {
  it("lists the quotes in one language with their embedding estimate", async () => {
    const res = await candidates("kind=quotes&slug=wu&language=en");
    expect(res.status).toBe(200);
    const body = (await res.json()) as CandidatesResult;
    expect(body.total).toBe(1);
    expect(body.items).toEqual([
      expect.objectContaining({ kind: "quotes", site: "wikiquote", language: "en", title: "Chien-Shiung Wu", count: 2, estimated: embeddingEstimate(body.items[0].chars) }),
    ]);
  });

  it("lists linked articles of that language's edition, minus generic pages", async () => {
    const body = (await (await candidates("kind=linked&slug=wu&language=en")).json()) as CandidatesResult;
    expect(body.items.map((c) => c.title).sort()).toEqual(["Columbia University", "Manhattan Project"]);
    expect(body.items.every((c) => c.estimated === embeddingEstimate(4_000))).toBe(true);
  });

  it("lists mentions with the paragraphs that will be kept", async () => {
    const body = (await (await candidates("kind=mention&slug=wu&language=en&offset=0")).json()) as CandidatesResult;
    expect(body.total).toBe(1);
    expect(body.items[0]).toMatchObject({ kind: "mention", title: "Columbia University", preview: "In 1956 Chien-Shiung Wu showed parity violation at Columbia." });
  });

  it("rejects an unknown kind or a missing target with 400", async () => {
    expect((await candidates("kind=gossip&slug=wu&language=en")).status).toBe(400);
    expect((await candidates("kind=quotes&language=en")).status).toBe(400);
  });
});

describe("POST /api/admin/personas/rounds (spec §34.6)", () => {
  // Review Focus 1.
  it("refuses with 409 round_running as JSON while a round runs, before any fetch", async () => {
    await startRound(pool(), "wu", adminId);
    const res = await rounds({ slug: "wu", plan: EN_PLAN });
    expect(res.status).toBe(409);
    expect(res.headers.get("Content-Type")).toContain("application/json");
    expect((await res.json()).code).toBe("round_running");
    expect(wiki.extract).not.toHaveBeenCalled();
    expect(embedder.calls).toBe(0);
  });

  it("streams progress, then done with the round's cost", async () => {
    const res = await rounds({ slug: "wu", plan: EN_PLAN });
    expect(res.status).toBe(200);
    expect(res.headers.get("Content-Type")).toBe("application/x-ndjson");
    const all = await events(res);
    expect(all[0]).toEqual({ type: "progress", label: "Fetching texts", status: "started", spent: 0 });
    expect(all.filter((e) => e.type === "progress").map((e) => e.type === "progress" && e.status)).toContain("finished");
    const done = all.at(-1)!;
    expect(done).toEqual({ type: "done", slug: "wu", cost: expect.any(Number) });
    const [round] = await listRounds(pool(), "wu");
    expect(round.status).toBe("done");
    expect(done.type === "done" && done.cost).toBe(round.items.reduce((n, i) => n + (i.cost ?? 0), 0));
    expect(done.type === "done" && done.cost).toBeGreaterThan(0);
  });

  it("answers 422 too_large as JSON before anything is paid", async () => {
    const plan: SourcePlan = { ...EN_PLAN, extras: [{ kind: "linked", site: "wikipedia", language: "en", title: "Huge", estimated: 10 }] };
    const res = await rounds({ slug: "wu", plan });
    expect(res.status).toBe(422);
    expect((await res.json()).code).toBe("too_large");
    expect(embedder.calls).toBe(0);
    expect((await listRounds(pool(), "wu"))[0].status).toBe("failed");
  });

  it("finishes the round and records its costs when the admin closes the tab", async () => {
    let release!: () => void;
    const gate = new Promise<void>((resolve) => (release = resolve));
    const slow = new FakeEmbeddings();
    fakes.round = {
      ...(fakes.round as object),
      embeddings: (ledger: CostLedger) =>
        meteredEmbeddings({ embedDocuments: async (t) => (await gate, slow.embedDocuments(t)), embedQuery: (t) => slow.embedQuery(t) }, ledger, EMBEDDING_MODEL),
    };
    const res = await rounds({ slug: "wu", plan: EN_PLAN });
    expect(res.status).toBe(200);
    await res.body!.cancel();
    release();
    await vi.waitFor(async () => expect((await listRounds(pool(), "wu"))[0].status).toBe("done"), { timeout: 5_000 });
    const [round] = await listRounds(pool(), "wu");
    expect(round.items[0].cost).toBeGreaterThan(0);
    const { rows } = await pool().query(`SELECT count(*)::int AS n FROM model_calls WHERE ingest_item_id = $1`, [round.items[0].id]);
    expect(rows[0].n).toBe(1);
  });

  it("adds a new persona by title", async () => {
    const res = await rounds({ title: "Chien-Shiung Wu", plan: EN_PLAN });
    expect(res.status).toBe(200);
    expect((await events(res)).at(-1)).toEqual({ type: "done", slug: "chien-shiung-wu", cost: expect.any(Number) });
    const { rows } = await pool().query(`SELECT status, origin, highlights FROM personas WHERE slug = 'chien-shiung-wu'`);
    expect(rows[0]).toEqual({ status: "ready", origin: "user", highlights: "Born in Liuhe." });
  });

  it("refuses a new persona whose slug is taken with 409, before anything is fetched or paid", async () => {
    await insertPersona({ slug: "chien-shiung-wu", displayName: "Chien-Shiung Wu", origin: "user" });
    const res = await rounds({ title: "Chien-Shiung Wu", plan: EN_PLAN });
    expect(res.status).toBe(409);
    expect((await res.json()).code).toBe("conflict");
    expect(wiki.extract).not.toHaveBeenCalled();
    expect(embedder.calls).toBe(0);
  });

  it("rejects an invalid plan with 400", async () => {
    const res = await rounds({ slug: "wu", plan: { ...EN_PLAN, extras: Array.from({ length: 201 }, (_, i) => ({ kind: "linked", site: "wikipedia", language: "en", title: `P${i}`, estimated: 1 })) } });
    expect(res.status).toBe(400);
    expect((await rounds({ slug: "wu", plan: { ...EN_PLAN, article: { ...EN_PLAN.article, site: "wikiquote" } } })).status).toBe(400);
  });

  it("answers 404 for an unknown slug", async () => {
    expect((await rounds({ slug: "nobody", plan: EN_PLAN })).status).toBe(404);
  });
});
