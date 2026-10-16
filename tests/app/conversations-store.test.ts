import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { closePool, getPool } from "@corpus/db";
import { HISTORY_WINDOW } from "@/lib/chat-types";
import { beginTurn, deleteConversation, findConversation, listConversations, loadTurnContext, readConversation, settleTurn, type BeginTurn } from "@/lib/server/conversations";
import { saveFeedback } from "@/lib/server/feedback";
import type { ResolvedCall } from "@/lib/server/pricing";
import type { VisitorAct } from "@/lib/visitor-act";
import { resetAuth } from "../helpers/db";
import { giveEnergy } from "../helpers/energy";
import { conversationRow, exchanges, insertUser, messagesOf, seedConversation } from "../helpers/conversations";

const ACT: VisitorAct = { act: "question", offense: 0, sorePoint: false, language: "en", wants: "normal", visitorName: null };
const CONV = "8f14e45f-ceea-467f-a0e6-2b8a2a6b1c11";
const pool = () => getPool();

let ana: string;
beforeEach(async () => {
  await resetAuth();
  ana = await insertUser("ana@example.com");
});
afterAll(() => closePool());

const turn = (over: Partial<BeginTurn> = {}): BeginTurn => ({
  conversationId: CONV,
  userId: ana,
  personaSlug: "wu",
  personaName: "Chien-Shiung Wu",
  visitor: { text: "Hi", act: ACT },
  ending: null,
  create: true,
  ...over,
});

/** A turn that has finished: the flag beginTurn set is cleared, as settleTurn would. */
const finishTurn = () => pool().query(`UPDATE conversations SET turn_running_since = NULL WHERE id = $1`, [CONV]);

describe("beginTurn", () => {
  it("creates the conversation on its first turn and stores the visitor message with its act", async () => {
    expect(await beginTurn(pool(), turn())).toEqual({ ok: true });
    expect(await conversationRow(CONV)).toMatchObject({ user_id: ana, persona_slug: "wu", persona_name: "Chien-Shiung Wu", ended: null });
    expect(await messagesOf(CONV)).toEqual([
      { role: "user", text: "Hi", act: ACT, tool_calls: null, sources: null, ended: null, stopped: false },
    ]);
  });

  it("adds to an existing conversation and stores a null act as null", async () => {
    await beginTurn(pool(), turn());
    await finishTurn();
    await beginTurn(pool(), turn({ visitor: { text: "Again", act: null } }));
    expect((await messagesOf(CONV)).map((m) => [m.text, m.act])).toEqual([
      ["Hi", ACT],
      ["Again", null],
    ]);
  });

  it("doesn't create a missing conversation when create is false", async () => {
    expect(await beginTurn(pool(), turn({ create: false }))).toEqual({ ok: false, reason: "not_found" });
    expect(await conversationRow(CONV)).toBeUndefined();
  });

  it("refuses another user's conversation as not_found, and stores nothing", async () => {
    await seedConversation({ id: CONV, userId: await insertUser("bo@example.com") });
    expect(await beginTurn(pool(), turn())).toEqual({ ok: false, reason: "not_found" });
    expect(await messagesOf(CONV)).toEqual([]);
  });

  it("locks the ending with the turn that ends the visit, then refuses every later turn", async () => {
    expect(await beginTurn(pool(), turn({ ending: "offended" }))).toEqual({ ok: true });
    expect((await conversationRow(CONV)).ended).toBe("offended");
    expect(await beginTurn(pool(), turn({ visitor: { text: "Sorry", act: ACT } }))).toEqual({ ok: false, reason: "ended" });
    expect(await messagesOf(CONV)).toHaveLength(1);
  });

  it("lets only one of two racing turns through when the first ends the visit", async () => {
    await beginTurn(pool(), turn());
    await finishTurn();
    const results = await Promise.all([
      beginTurn(pool(), turn({ visitor: { text: "Bye", act: { ...ACT, act: "farewell" } }, ending: "farewell" })),
      beginTurn(pool(), turn({ visitor: { text: "Bye too", act: { ...ACT, act: "farewell" } }, ending: "farewell" })),
    ]);
    expect(results.map((r) => r.ok).sort()).toEqual([false, true]);
    expect(await messagesOf(CONV)).toHaveLength(2);
  });

  it("inserts nothing on Retry (no visitor message)", async () => {
    await beginTurn(pool(), turn());
    await finishTurn();
    expect(await beginTurn(pool(), turn({ visitor: null }))).toEqual({ ok: true });
    expect(await messagesOf(CONV)).toHaveLength(1);
  });
});

const resolved = (extra: Partial<ResolvedCall> = {}): ResolvedCall => ({
  role: "agent", model: "openai/gpt-5.5", inputTokens: 900, outputTokens: 100, cost: 30_000, costSource: "reported", generationId: "gen-1", latencyMs: 800, ...extra,
});
const reply = { id: "r", role: "persona" as const, text: "Parity is violated.", toolCalls: [], sources: [] };

describe("settleTurn (spec §26.4)", () => {
  it("stores the reply with its trace, sources and ending, and bumps updated_at", async () => {
    await beginTurn(pool(), turn());
    const before = (await conversationRow(CONV)).updated_at as Date;
    const toolCalls = [{ id: "t1", toolName: "search_biography", arguments: { query: "parity" }, status: "ok" as const, result: {}, durationMs: 5 }];
    const sources = [{ personaId: "wu", sectionHeading: "Parity", chunkId: 7 }];
    await settleTurn(pool(), { conversationId: CONV, userId: ana, charge: false, reply: { ...reply, text: "Parity fails.", toolCalls, sources, ended: "farewell" }, calls: [] });
    expect((await messagesOf(CONV))[1]).toMatchObject({ role: "persona", text: "Parity fails.", tool_calls: toolCalls, sources, ended: "farewell", stopped: false });
    expect(((await conversationRow(CONV)).updated_at as Date).getTime()).toBeGreaterThanOrEqual(before.getTime());
  });

  it("stores the reply with its cost, logs the calls, charges the tester and adds to the totals, at once", async () => {
    const userId = ana;
    await giveEnergy(userId, 1_000_000);
    const id = await seedConversation({ userId, messages: [{ role: "user", text: "hi" }] });
    await getPool().query(`UPDATE conversations SET turn_running_since = now() WHERE id = $1`, [id]);
    const settled = await settleTurn(getPool(), {
      conversationId: id, userId, charge: true, reply,
      calls: [resolved(), resolved({ role: "classifier", inputTokens: 200, outputTokens: 20, cost: 500, costSource: "estimated" })],
    });
    expect(settled).toEqual({
      balance: 969_500, full: 1_000_000,
      turn: { tokens: 1_220, cost: 30_500, inputTokens: 1_100, outputTokens: 120 },
      conversation: { tokens: 1_220, cost: 30_500 },
    });
    const { rows } = await getPool().query(
      `SELECT m.cost, m.tokens, (SELECT count(*)::int FROM model_calls mc WHERE mc.message_id = m.id) AS calls, c.turn_running_since
       FROM messages m JOIN conversations c ON c.id = m.conversation_id WHERE m.role = 'persona' AND c.id = $1`,
      [id],
    );
    expect(rows[0]).toEqual({ cost: "30500", tokens: 1_220, calls: 2, turn_running_since: null });
  });

  it("charges a turn that failed without a reply", async () => {
    const userId = ana;
    await giveEnergy(userId, 1_000_000);
    const id = await seedConversation({ userId });
    const settled = await settleTurn(getPool(), { conversationId: id, userId, charge: true, reply: null, calls: [resolved({ cost: 500 })] });
    expect(settled.balance).toBe(999_500);
    const { rows } = await getPool().query(`SELECT count(*)::int AS n FROM messages WHERE conversation_id = $1`, [id]);
    expect(rows[0].n).toBe(0);
  });

  it("lets the balance go below zero (spec §26.1)", async () => {
    const userId = ana;
    await giveEnergy(userId, 10_000, 1_000_000);
    const id = await seedConversation({ userId });
    expect((await settleTurn(getPool(), { conversationId: id, userId, charge: true, reply, calls: [resolved()] })).balance).toBe(-20_000);
  });

  it("doesn't charge the admin, but still logs and totals", async () => {
    const userId = await insertUser("boss@example.com");
    const id = await seedConversation({ userId });
    const settled = await settleTurn(getPool(), { conversationId: id, userId, charge: false, reply, calls: [resolved()] });
    expect(settled.balance).toBeNull();
    expect(settled.conversation.cost).toBe(30_000);
  });
});

describe("the turn flag (spec §26.4)", () => {
  it("refuses a second turn while one runs, and lets it through after 2 minutes", async () => {
    const id = await seedConversation({ userId: ana });
    const t = { conversationId: id, userId: ana, personaSlug: "wu", personaName: "Wu", visitor: { text: "hi", act: null }, ending: null, create: false };
    expect(await beginTurn(getPool(), t)).toEqual({ ok: true });
    expect((await findConversation(getPool(), id))?.turnRunning).toBe(true);
    expect(await beginTurn(getPool(), t)).toEqual({ ok: false, reason: "busy" });
    await getPool().query(`UPDATE conversations SET turn_running_since = now() - interval '3 minutes' WHERE id = $1`, [id]);
    expect((await findConversation(getPool(), id))?.turnRunning).toBe(false);
    expect(await beginTurn(getPool(), t)).toEqual({ ok: true });
  });
});

describe("loadTurnContext and findConversation", () => {
  it("gives the last HISTORY_WINDOW messages, every act, and whether the newest is unanswered", async () => {
    await seedConversation({ id: CONV, userId: ana, messages: [...exchanges(15, ACT), { role: "user", text: "Last", act: null }] });
    const ctx = await loadTurnContext(pool(), CONV);
    expect(ctx.history).toHaveLength(HISTORY_WINDOW);
    expect(ctx.history.at(-1)).toEqual({ role: "user", text: "Last" });
    expect(ctx.acts).toHaveLength(16);
    expect(ctx.acts.at(-1)).toBeNull();
    expect(ctx.unanswered).toBe(true);
  });

  it("reads a stored act that no longer parses as null", async () => {
    await seedConversation({ id: CONV, userId: ana });
    await pool().query(`INSERT INTO messages (conversation_id, role, text, act) VALUES ($1, 'user', 'x', '{"act":"shout"}')`, [CONV]);
    expect((await loadTurnContext(pool(), CONV)).acts).toEqual([null]);
  });

  it("finds a conversation with its owner, persona and ending, or null", async () => {
    await seedConversation({ id: CONV, userId: ana, ended: "tired" });
    expect(await findConversation(pool(), CONV)).toEqual({ id: CONV, userId: ana, personaSlug: "wu", personaName: "Chien-Shiung Wu", ended: "tired", turnRunning: false });
    expect(await findConversation(pool(), crypto.randomUUID())).toBeNull();
  });
});

describe("listConversations", () => {
  it("lists only the user's conversations, newest first, with a one-line preview", async () => {
    const older = await seedConversation({ userId: ana, messages: [{ role: "user", text: "First\nquestion", act: ACT }, { role: "persona", text: "A" }] });
    const newer = await seedConversation({ userId: ana, personaSlug: "curie", personaName: "Marie Curie", ended: "farewell", messages: [{ role: "user", text: "Bonjour", act: ACT }] });
    await pool().query(`UPDATE conversations SET updated_at = now() - interval '1 hour' WHERE id = $1`, [older]);
    await seedConversation({ userId: await insertUser("bo@example.com"), messages: [{ role: "user", text: "Not yours", act: ACT }] });

    const list = await listConversations(pool(), ana);
    expect(list.map((c) => c.id)).toEqual([newer, older]);
    expect(list[0]).toEqual({ id: newer, personaId: "curie", personaName: "Marie Curie", preview: "Bonjour", updatedAt: expect.any(String), ended: "farewell", stars: null });
    expect(list[1].preview).toBe("First question");
  });
});

describe("readConversation", () => {
  it("returns the messages in the Message shape, act and stopped included", async () => {
    await seedConversation({ id: CONV, userId: ana, messages: [{ role: "user", text: "Hi", act: ACT }] });
    await pool().query(`INSERT INTO messages (conversation_id, role, text, tool_calls, sources, stopped) VALUES ($1, 'persona', 'Half', '[]', '[]', true)`, [CONV]);
    const c = await readConversation(pool(), ana, CONV, { costs: false });
    expect(c).toMatchObject({ id: CONV, personaId: "wu", personaName: "Chien-Shiung Wu", updatedAt: expect.any(String) });
    expect(c!.messages).toEqual([
      { id: expect.any(String), role: "user", text: "Hi", act: ACT },
      { id: expect.any(String), role: "persona", text: "Half", toolCalls: [], sources: [], stopped: true },
    ]);
  });

  it("is null for another user's conversation", async () => {
    await seedConversation({ id: CONV, userId: await insertUser("bo@example.com") });
    expect(await readConversation(pool(), ana, CONV, { costs: false })).toBeNull();
  });

  it("still reads after the persona is gone (no foreign key to personas)", async () => {
    await seedConversation({ id: CONV, userId: ana, personaSlug: "removed", personaName: "Someone Removed" });
    expect((await readConversation(pool(), ana, CONV, { costs: false }))?.personaName).toBe("Someone Removed");
  });
});

describe("readConversation and costs", () => {
  it("carries costs only when asked, and always the turn flag", async () => {
    const userId = ana;
    const id = await seedConversation({ userId, messages: [{ role: "user", text: "hi" }] });
    await settleTurn(getPool(), { conversationId: id, userId, charge: false, reply, calls: [resolved()] });
    const plain = await readConversation(getPool(), userId, id, { costs: false });
    expect(JSON.stringify(plain)).not.toMatch(/"cost"|"tokens"|"spend"/);
    expect(plain?.turnRunning).toBe(false);
    const admin = await readConversation(getPool(), userId, id, { costs: true });
    expect(admin?.spend).toEqual({ tokens: 1_000, cost: 30_000 });
    expect(admin?.messages.at(-1)).toMatchObject({ cost: 30_000, tokens: 1_000 });
  });
});

describe("deleteConversation", () => {
  it("hard-deletes the user's own conversation and its messages, and nothing else", async () => {
    await seedConversation({ id: CONV, userId: ana, messages: exchanges(2, ACT) });
    const bo = await insertUser("bo@example.com");
    const theirs = await seedConversation({ userId: bo });
    expect(await deleteConversation(pool(), bo, CONV)).toBe(false);
    expect(await deleteConversation(pool(), ana, CONV)).toBe(true);
    expect(await conversationRow(CONV)).toBeUndefined();
    expect(await messagesOf(CONV)).toEqual([]);
    expect(await conversationRow(theirs)).toBeDefined();
  });

  it("goes with its user (cascade)", async () => {
    await seedConversation({ id: CONV, userId: ana, messages: exchanges(1, ACT) });
    await pool().query(`DELETE FROM "user" WHERE id = $1`, [ana]);
    expect(await conversationRow(CONV)).toBeUndefined();
    expect(await messagesOf(CONV)).toEqual([]);
  });
});

describe("the admin's view (spec §27)", () => {
  it("lists every user's conversations with the owner's email and mine; a tester's list is unchanged", async () => {
    const boss = await insertUser("owner-boss@example.com");
    const ana = await insertUser("owner-ana@example.com");
    const mineId = await seedConversation({ userId: boss, messages: [{ role: "user", text: "mine" }] });
    const hersId = await seedConversation({ userId: ana, messages: [{ role: "user", text: "hers" }] });
    const all = await listConversations(getPool(), boss, { all: true });
    expect(all.map((c) => ({ id: c.id, userEmail: c.userEmail, mine: c.mine })).sort((a, b) => a.id.localeCompare(b.id))).toEqual(
      [
        { id: mineId, userEmail: "owner-boss@example.com", mine: true },
        { id: hersId, userEmail: "owner-ana@example.com", mine: false },
      ].sort((a, b) => a.id.localeCompare(b.id)),
    );
    const own = await listConversations(getPool(), ana);
    expect(own.map((c) => c.id)).toEqual([hersId]);
    expect(JSON.stringify(own)).not.toMatch(/userEmail|"mine"/);
  });

  it("reads another user's conversation with the owner's email only when anyOwner is set", async () => {
    const boss = await insertUser("owner-boss@example.com");
    const ana = await insertUser("owner-ana@example.com");
    const id = await seedConversation({ userId: ana, messages: [{ role: "user", text: "hi" }] });
    expect(await readConversation(getPool(), boss, id, { costs: true })).toBeNull();
    expect(await readConversation(getPool(), boss, id, { costs: true, anyOwner: true })).toMatchObject({ id, userEmail: "owner-ana@example.com" });
    expect(JSON.stringify(await readConversation(getPool(), ana, id, { costs: false }))).not.toContain("userEmail");
  });
});

describe("feedback in History (spec §32.3)", () => {
  const rate = (conversationId: string, userId: string, stars: number, comment = "") =>
    saveFeedback(pool(), { conversationId, userId, stars, comment, model: "m", commitSha: "dev" });

  it("lists each conversation's stars, null when unrated", async () => {
    const rated = await seedConversation({ userId: ana, messages: [{ role: "user", text: "Hi", act: ACT }] });
    const unrated = await seedConversation({ userId: ana, messages: [{ role: "user", text: "Yo", act: ACT }] });
    await rate(rated, ana, 4);
    const list = await listConversations(pool(), ana);
    expect(Object.fromEntries(list.map((c) => [c.id, c.stars]))).toEqual({ [rated]: 4, [unrated]: null });
  });

  it("reads a conversation's rating, null when unrated, the owner's when the admin reads it", async () => {
    const id = await seedConversation({ userId: ana, messages: [{ role: "user", text: "Hi", act: ACT }] });
    expect((await readConversation(pool(), ana, id, { costs: false }))?.feedback).toBeNull();
    await rate(id, ana, 5, "Great");
    expect((await readConversation(pool(), ana, id, { costs: false }))?.feedback).toEqual({ stars: 5, comment: "Great" });
    const boss = await insertUser("boss@example.com");
    expect((await readConversation(pool(), boss, id, { costs: true, anyOwner: true }))?.feedback).toEqual({ stars: 5, comment: "Great" });
  });
});
