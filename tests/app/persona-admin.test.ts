import { afterAll, beforeEach, describe, expect, it } from "vitest";
import type { ModelCallRecord } from "@corpus/cost-ledger";
import { closePool, getPool } from "@corpus/db";
import { EMBEDDING_MODEL } from "@corpus/embeddings";
import type { CharacterProfile } from "@corpus/profile";
import { addItem, draftRound, finishRound, insertSource, saveComparison, startRound, type EditionScore } from "@corpus/rounds";
import { IngestError } from "@corpus/ingest";
import { RoundError } from "@corpus/reingest";
import { WikipediaError } from "@corpus/wikimedia";
import { adminError, loadPersonaProfile, roundDeps, roundErrorEvent, saveHighlights } from "@/lib/server/persona-admin";
import { saveFeedback } from "@/lib/server/feedback";
import type { VisitorAct } from "@/lib/visitor-act";
import { insertPersona, resetAuth, resetDb } from "../helpers/db";
import { insertUser, seedConversation } from "../helpers/conversations";
import { giveEnergy } from "../helpers/energy";

const pool = () => getPool();
const ACT: VisitorAct = { act: "question", offense: 0, sorePoint: false, language: "en", wants: "normal", visitorName: null };
const PROFILE: CharacterProfile = {
  temperament: "Exacting",
  humour: "unknown",
  passions: "Beta decay",
  indifferences: "unknown",
  speech: "Precise",
  sore_points: "unknown",
};
const SCORE: EditionScore = { language: "pt", title: "Wu Chien-Shiung", words: 900, badge: "good", answered: 21, total: 30 };

let admin: string;
let wuId: number;
beforeEach(async () => {
  await resetDb();
  await resetAuth();
  await pool().query("TRUNCATE ingest_rounds RESTART IDENTITY CASCADE");
  admin = await insertUser("boss@example.com");
  wuId = await insertPersona({ slug: "wu", displayName: "Chien-Shiung Wu", origin: "user", description: "Physicist", lifespan: "1912–1997", wikidataQid: "Q123" });
  await pool().query(
    `UPDATE personas SET highlights = 'Born in Liuhe.', profile = $2::jsonb, languages = $3::jsonb, languages_source = 'wikidata' WHERE id = $1`,
    [wuId, JSON.stringify(PROFILE), JSON.stringify([{ code: "zh", name: "Chinese", native: true }, { code: "en", name: "English", native: false }])],
  );
});
afterAll(() => closePool());

describe("loadPersonaProfile (spec §34.4)", () => {
  it("returns null for an unknown slug", async () => {
    expect(await loadPersonaProfile(pool(), "nobody")).toBeNull();
  });

  it("returns the persona, its sources, rounds newest first, what was spent and its own ratings", async () => {
    const r1 = await startRound(pool(), "wu", admin);
    const sourceId = await insertSource(pool(), wuId, r1, { kind: "article", site: "wikipedia", language: "en", title: "Chien-Shiung Wu", revid: 42, passages: 12 });
    await addItem(pool(), r1, { action: "added", label: "English article, 12 passages", passages: 12, estimated: 900, cost: 1_200 });
    await addItem(pool(), r1, { action: "redrafted", label: "Highlights and character redrafted", passages: null, estimated: 500, cost: 300 });
    await finishRound(pool(), r1, "done");
    const r2 = await draftRound(pool(), "wu", admin);
    await saveComparison(pool(), r2, [SCORE], { label: "Compared editions", estimated: 600, cost: 400 });
    expect(sourceId).toBeGreaterThan(0);

    const tester = await insertUser("t@example.com");
    const mine = await seedConversation({ userId: tester, personaSlug: "wu", messages: [{ role: "user", text: "Hi", act: ACT }] });
    const other = await seedConversation({ userId: tester, personaSlug: "einstein", personaName: "Albert Einstein", messages: [{ role: "user", text: "Hi", act: ACT }] });
    await saveFeedback(pool(), { conversationId: mine, userId: tester, stars: 4, comment: "Good", model: "m", commitSha: "dev" });
    await saveFeedback(pool(), { conversationId: other, userId: tester, stars: 1, comment: "", model: "m", commitSha: "dev" });

    const dto = (await loadPersonaProfile(pool(), "wu"))!;
    expect(dto).toMatchObject({
      slug: "wu",
      name: "Chien-Shiung Wu",
      description: "Physicist",
      lifespan: "1912–1997",
      origin: "user",
      highlights: "Born in Liuhe.",
      profile: PROFILE,
      languages: [
        { code: "zh", name: "Chinese", native: true, source: "Wikidata" },
        { code: "en", name: "English", native: false, source: "Wikidata" },
      ],
      sources: [
        { kind: "article", site: "wikipedia", language: "en", title: "Chien-Shiung Wu", revid: 42, url: "https://en.wikipedia.org/wiki/Chien-Shiung_Wu", passages: 12 },
      ],
      spent: 1_900,
      running: false,
    });
    expect(dto.sources[0]).not.toHaveProperty("id");
    expect(dto.sources[0]).not.toHaveProperty("roundId");
    expect(dto.rounds.map((r) => [r.number, r.status, r.note, r.cost])).toEqual([
      [2, "draft", "Compared, not ingested", 400],
      [1, "done", null, 1_500],
    ]);
    expect(dto.rounds[1].startedAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    expect(dto.rounds[1].finishedAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    expect(dto.rounds[1].items.map((i) => [i.action, i.cost])).toEqual([["added", 1_200], ["redrafted", 300]]);
    expect(dto.comparison).toEqual({ scores: [SCORE], comparedAt: dto.rounds[0].startedAt });
    expect(dto.ratings.items.map((i) => i.conversationId)).toEqual([mine]);
    expect(dto.ratings.summary.count).toBe(1);
    // Browser-safe: plain JSON survives the trip unchanged.
    expect(JSON.parse(JSON.stringify(dto))).toEqual(dto);
  });

  it("reports a running round, and shows a stale one as failed", async () => {
    const r1 = await startRound(pool(), "wu", admin);
    await addItem(pool(), r1, { action: "added", label: "English article", passages: null, estimated: 900, cost: null });
    let dto = (await loadPersonaProfile(pool(), "wu"))!;
    expect(dto.running).toBe(true);
    expect(dto.rounds[0]).toMatchObject({ status: "running", note: "Reingest running", cost: null });
    expect(dto.spent).toBe(0);

    await pool().query(`UPDATE ingest_rounds SET started_at = now() - interval '11 minutes' WHERE id = $1`, [r1]);
    dto = (await loadPersonaProfile(pool(), "wu"))!;
    expect(dto.running).toBe(false);
    expect(dto.rounds[0]).toMatchObject({ status: "failed", note: null });
  });

  it("labels each language source and falls back to English when none is stored", async () => {
    await insertPersona({ slug: "curie", displayName: "Marie Curie", origin: "curated" });
    await pool().query(
      `UPDATE personas SET languages = '[{"code":"pl","name":"Polish","native":true}]'::jsonb, languages_source = 'curated' WHERE slug = 'curie'`,
    );
    await insertPersona({ slug: "nobel", displayName: "Alfred Nobel", origin: "user" });
    expect((await loadPersonaProfile(pool(), "curie"))!.languages).toEqual([{ code: "pl", name: "Polish", native: true, source: "set by hand" }]);
    const nobel = (await loadPersonaProfile(pool(), "nobel"))!;
    expect(nobel.languages).toEqual([{ code: "en", name: "English", native: true, source: "none found, English assumed" }]);
    expect(nobel).toMatchObject({ highlights: null, profile: null, sources: [], rounds: [], spent: 0, comparison: null });
  });
});

describe("saveHighlights (spec §34.4)", () => {
  it("stores the trimmed text as typed", async () => {
    expect(await saveHighlights(pool(), "wu", "  Born in Liuhe, Jiangsu.\n\nFamous for parity.  ")).toBe(true);
    const { rows } = await pool().query(`SELECT highlights FROM personas WHERE slug = 'wu'`);
    expect(rows[0].highlights).toBe("Born in Liuhe, Jiangsu.\n\nFamous for parity.");
  });

  it("returns false for an unknown slug", async () => {
    expect(await saveHighlights(pool(), "nobody", "Text")).toBe(false);
  });

  it("refuses an empty text or one over 1,500 characters", async () => {
    await expect(saveHighlights(pool(), "wu", "   ")).rejects.toThrow(RangeError);
    await expect(saveHighlights(pool(), "wu", "a".repeat(1_501))).rejects.toThrow(RangeError);
    expect(await saveHighlights(pool(), "wu", "a".repeat(1_500))).toBe(true);
  });
});

describe("roundDeps().onItemCalls (spec §34.6, §34.9)", () => {
  it("logs the item's calls against the admin without charging, links them to the item and stores its cost", async () => {
    await giveEnergy(admin, 500_000);
    const roundId = await startRound(pool(), "wu", admin);
    const itemId = await addItem(pool(), roundId, { action: "added", label: "English article", passages: 3, estimated: 30, cost: null });
    const calls: ModelCallRecord[] = [
      { role: "embedding", model: EMBEDDING_MODEL, inputTokens: 1_000, outputTokens: 0, cost: null, generationId: null, latencyMs: 5 },
      { role: "ingest", model: "m", inputTokens: 10, outputTokens: 5, cost: 400, generationId: "g1", latencyMs: 9 },
    ];

    const cost = await roundDeps(admin, "wu").onItemCalls(itemId, calls);

    expect(cost).toBe(420); // 1,000 tokens × 0.02 + 400
    const { rows } = await pool().query(`SELECT user_id, persona_slug, role, cost, ingest_item_id FROM model_calls ORDER BY id`);
    expect(rows.map((r) => [r.user_id, r.persona_slug, r.role, Number(r.cost), r.ingest_item_id])).toEqual([
      [admin, "wu", "embedding", 20, itemId],
      [admin, "wu", "ingest", 400, itemId],
    ]);
    const item = await pool().query(`SELECT cost FROM ingest_round_items WHERE id = $1`, [itemId]);
    expect(Number(item.rows[0].cost)).toBe(420);
    const user = await pool().query(`SELECT "energyBalance" FROM "user" WHERE id = $1`, [admin]);
    expect(Number(user.rows[0].energyBalance)).toBe(500_000);
  });
});

describe("adminError and roundErrorEvent", () => {
  it.each([
    [new RoundError("round_running", "Busy."), 409, "round_running"],
    [new RoundError("too_large", "Too long."), 422, "too_large"],
    [new RoundError("persona_gone", "Gone."), 404, "persona_gone"],
    [new IngestError("in_progress", "Already being added."), 409, "in_progress"],
    [new WikipediaError("unreachable", "pt.wikipedia.org is rate-limiting; try again in a few minutes."), 502, "unreachable"],
  ])("maps %s to its status and code", async (err, status, code) => {
    const res = adminError(err);
    expect(res.status).toBe(status);
    expect(await res.json()).toEqual({ error: err.message, code });
    expect(roundErrorEvent(err)).toEqual({ type: "error", message: err.message, code });
  });

  it("hides an unknown error's details in the stream", () => {
    expect(roundErrorEvent(new Error("socket hang up"))).toEqual({ type: "error", message: "The round failed. Try again in a moment." });
  });
});
