import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { closePool, getPool } from "../../corpus/db";
import { applySchema } from "../../corpus/schema";
import {
  addItem, draftRound, finishRound, listRounds, listSources, RoundBusyError, roundHasEstimatedCost, runningRound, saveComparison,
  setItemCost, sourceKey, startRound, type EditionScore,
} from "../../corpus/rounds";
import { insertChunks, insertPersona, resetDb } from "../helpers/db";
import { insertUser } from "../helpers/conversations";
import { resetAuth } from "../helpers/db";
import { recordCalls } from "@/lib/server/spend";

const pool = () => getPool();
const vec = () => Array.from({ length: 1536 }, () => 0.1);
const SCORE: EditionScore = { language: "pt", title: "Getúlio Vargas", words: 9000, badge: "featured", answered: 4, total: 5 };

async function cleanRounds() {
  await pool().query("TRUNCATE ingest_rounds RESTART IDENTITY CASCADE");
}
beforeEach(async () => {
  await resetDb();
  await resetAuth();
  await cleanRounds();
});
afterAll(() => closePool());

describe("schema (spec §34.2)", () => {
  it("has the new tables and columns", async () => {
    const { rows } = await pool().query(
      `SELECT table_name || '.' || column_name AS c FROM information_schema.columns
       WHERE (table_name, column_name) IN (('chunks','source_id'), ('model_calls','ingest_item_id'), ('personas','highlights'),
         ('personas','languages_source'), ('ingest_rounds','comparison'), ('persona_sources','url'),
         ('ingest_round_items','cost'), ('passage_translations','content_hash'))`,
    );
    expect(rows).toHaveLength(8);
  });

  it("accepts draft rounds and allows one running round per slug", async () => {
    await pool().query(`INSERT INTO ingest_rounds (persona_slug, number, status, started_by) VALUES ('wu', 1, 'draft', 'a')`);
    await pool().query(`INSERT INTO ingest_rounds (persona_slug, number, status, started_by) VALUES ('wu', 2, 'running', 'a')`);
    await expect(
      pool().query(`INSERT INTO ingest_rounds (persona_slug, number, status, started_by) VALUES ('wu', 3, 'running', 'a')`),
    ).rejects.toMatchObject({ constraint: "ingest_rounds_one_running" });
  });
});

describe("backfill of existing personas (spec §34.2)", () => {
  it("gives a persona with chunks one source, a round 1 and the recorded cost, and is idempotent", async () => {
    const id = await insertPersona({ slug: "chien-shiung-wu", displayName: "Chien-Shiung Wu", origin: "user" });
    await pool().query(`UPDATE personas SET wikipedia_title = 'Chien-Shiung Wu', wikipedia_revid = 77, languages = '[{"code":"en"}]'::jsonb WHERE id = $1`, [id]);
    await insertChunks(id, [vec(), vec(), vec()]);
    const ana = await insertUser("ana@example.com");
    const call = (role: "ingest" | "embedding" | "agent", cost: number) => ({ role, model: "m", inputTokens: 1, outputTokens: 1, cost, costSource: "reported" as const, generationId: null, latencyMs: 1 });
    await recordCalls(pool(), { userId: ana, calls: [call("ingest", 300), call("embedding", 50), call("agent", 9_000)], charge: false, personaSlug: "chien-shiung-wu" });

    await applySchema(pool());
    await applySchema(pool());

    const sources = await listSources(pool(), id);
    expect(sources).toHaveLength(1);
    expect(sources[0]).toMatchObject({
      kind: "article", site: "wikipedia", language: "en", title: "Chien-Shiung Wu", revid: 77, passages: 3,
      url: "https://en.wikipedia.org/wiki/Chien-Shiung_Wu",
    });
    const { rows: chunks } = await pool().query("SELECT DISTINCT source_id FROM chunks WHERE persona_id = $1", [id]);
    expect(chunks).toEqual([{ source_id: sources[0].id }]);

    const rounds = await listRounds(pool(), "chien-shiung-wu");
    expect(rounds).toHaveLength(1);
    expect(rounds[0]).toMatchObject({ number: 1, status: "done", comparison: null });
    expect(rounds[0].items).toEqual([
      { id: expect.any(Number), action: "added", label: "English article, 3 passages", passages: 3, estimated: null, cost: 350, costEstimated: false },
    ]);
    const { rows: p } = await pool().query("SELECT languages_source FROM personas WHERE id = $1", [id]);
    expect(p[0].languages_source).toBe("wikidata");
  });

  it("records no cost for a curated persona, and marks languages 'curated' only when it has them", async () => {
    const a = await insertPersona({ slug: "a" });
    const b = await insertPersona({ slug: "b" });
    const c = await insertPersona({ slug: "c", origin: "user" });
    await insertChunks(a, [vec()]);
    await pool().query(`UPDATE personas SET languages = '[]'::jsonb WHERE id = $1`, [a]);
    await pool().query(`UPDATE personas SET languages = '[]'::jsonb WHERE id = $1`, [c]);
    await applySchema(pool());
    expect((await listRounds(pool(), "a"))[0].items[0].cost).toBeNull();
    const { rows } = await pool().query("SELECT slug, languages_source FROM personas ORDER BY slug");
    expect(rows).toEqual([
      { slug: "a", languages_source: "curated" },
      { slug: "b", languages_source: null },
      { slug: "c", languages_source: "wikidata" },
    ]);
    expect(await listSources(pool(), b)).toEqual([]);
  });
});

describe("rounds (spec §34.2)", () => {
  it("builds source keys", () => {
    expect(sourceKey({ kind: "quotes", site: "wikiquote", language: "pt", title: "Getúlio Vargas" })).toBe("quotes:wikiquote:pt:Getúlio Vargas");
  });

  it("refuses a second running round for the same persona", async () => {
    await startRound(pool(), "wu", "admin");
    await expect(startRound(pool(), "wu", "admin")).rejects.toMatchObject({ code: "round_running" });
    await expect(startRound(pool(), "wu", "admin")).rejects.toBeInstanceOf(RoundBusyError);
    await startRound(pool(), "other", "admin");
  });

  it("concurrent starts give one running round and one RoundBusyError", async () => {
    const results = await Promise.allSettled([startRound(pool(), "wu", "a"), startRound(pool(), "wu", "b")]);
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    const rejected = results.filter((r): r is PromiseRejectedResult => r.status === "rejected");
    expect(rejected).toHaveLength(1);
    expect(rejected[0].reason).toBeInstanceOf(RoundBusyError);
    expect((await listRounds(pool(), "wu")).filter((r) => r.status === "running")).toHaveLength(1);
  });

  it("concurrent draftRound calls share one draft", async () => {
    const ids = await Promise.all([draftRound(pool(), "wu", "a"), draftRound(pool(), "wu", "a"), draftRound(pool(), "wu", "a")]);
    expect(new Set(ids).size).toBe(1);
    expect(await listRounds(pool(), "wu")).toHaveLength(1);
  });

  it("marks a running round older than 10 minutes failed and starts a new one", async () => {
    const first = await startRound(pool(), "wu", "admin");
    await pool().query(`UPDATE ingest_rounds SET started_at = now() - interval '11 minutes' WHERE id = $1`, [first]);
    const second = await startRound(pool(), "wu", "admin");
    expect(second).not.toBe(first);
    const rounds = await listRounds(pool(), "wu");
    expect(rounds.map((r) => [r.number, r.status])).toEqual([[2, "running"], [1, "failed"]]);
    expect(rounds[1].finishedAt).toBeInstanceOf(Date);
  });

  it("promotes the draft round to running", async () => {
    const draft = await draftRound(pool(), "wu", "admin");
    expect(await draftRound(pool(), "wu", "admin")).toBe(draft);
    await saveComparison(pool(), draft, [SCORE], { label: "Compared editions", estimated: 1_000, cost: 400 });
    const started = await startRound(pool(), "wu", "admin");
    expect(started).toBe(draft);
    const [round] = await listRounds(pool(), "wu");
    expect(round).toMatchObject({ id: draft, number: 1, status: "running", comparison: [SCORE] });
    expect(round.items).toEqual([
      { id: expect.any(Number), action: "compared", label: "Compared editions", passages: null, estimated: 1_000, cost: 400, costEstimated: false },
    ]);
    expect((await runningRound(pool(), "wu"))?.id).toBe(draft);
  });

  it("flags an item whose cost holds an estimated call (spec §34.2, final review Minor 1)", async () => {
    const user = await insertUser("admin@example.com");
    const r1 = await startRound(pool(), "wu", "admin");
    const embedded = await addItem(pool(), r1, { action: "added", label: "English article, 3 passages", passages: 3, estimated: 10, cost: 30 });
    const scored = await addItem(pool(), r1, { action: "compared", label: "Compared editions", passages: null, estimated: 10, cost: 20 });
    const call = { model: "m", inputTokens: 1, outputTokens: 0, generationId: null, latencyMs: 1 };
    await recordCalls(pool(), { userId: user, calls: [{ ...call, role: "embedding", cost: 30, costSource: "estimated" }], charge: false, ingestItemId: embedded });
    await recordCalls(pool(), { userId: user, calls: [{ ...call, role: "ingest", cost: 20, costSource: "reported" }], charge: false, ingestItemId: scored });

    const [round] = await listRounds(pool(), "wu");
    expect(round.items.map((i) => [i.label, i.costEstimated])).toEqual([["English article, 3 passages", true], ["Compared editions", false]]);
    expect(await roundHasEstimatedCost(pool(), r1)).toBe(true);
    await finishRound(pool(), r1, "done");
    const r2 = await startRound(pool(), "wu", "admin");
    const exact = await addItem(pool(), r2, { action: "compared", label: "Compared editions", passages: null, estimated: 10, cost: 20 });
    await recordCalls(pool(), { userId: user, calls: [{ ...call, role: "ingest", cost: 20, costSource: "reported" }], charge: false, ingestItemId: exact });
    expect(await roundHasEstimatedCost(pool(), r2)).toBe(false);
  });

  it("lists items in insertion order and rounds newest first; sets an item's cost", async () => {
    const r1 = await startRound(pool(), "wu", "admin");
    const i1 = await addItem(pool(), r1, { action: "added", label: "first", passages: 5, estimated: 10, cost: null });
    await addItem(pool(), r1, { action: "kept", label: "second", passages: null, estimated: null, cost: null });
    await setItemCost(pool(), i1, 123);
    await finishRound(pool(), r1, "done");
    expect(await runningRound(pool(), "wu")).toBeNull();
    const r2 = await startRound(pool(), "wu", "admin");
    await finishRound(pool(), r2, "failed");
    const rounds = await listRounds(pool(), "wu");
    expect(rounds.map((r) => [r.number, r.status])).toEqual([[2, "failed"], [1, "done"]]);
    expect(rounds[1].items.map((i) => [i.label, i.cost])).toEqual([["first", 123], ["second", null]]);
    expect(rounds[1].finishedAt).toBeInstanceOf(Date);
  });

  it("stores an ingest item id on recorded calls", async () => {
    const ana = await insertUser("ana@example.com");
    const round = await startRound(pool(), "wu", "admin");
    const item = await addItem(pool(), round, { action: "added", label: "x", passages: 1, estimated: null, cost: null });
    await recordCalls(pool(), {
      userId: ana, charge: false, personaSlug: "wu", ingestItemId: item,
      calls: [{ role: "embedding", model: "m", inputTokens: 1, outputTokens: 0, cost: 5, costSource: "estimated", generationId: null, latencyMs: null }],
    });
    const { rows } = await pool().query("SELECT ingest_item_id FROM model_calls WHERE persona_slug = 'wu'");
    expect(rows).toEqual([{ ingest_item_id: item }]);
  });
});
