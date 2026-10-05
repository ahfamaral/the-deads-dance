import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { closePool, getPool } from "@corpus/db";
import { HISTORY_WINDOW } from "@/lib/chat-types";
import { beginTurn, deleteConversation, findConversation, listConversations, loadTurnContext, readConversation, storeReply, type BeginTurn } from "@/lib/server/conversations";
import type { VisitorAct } from "@/lib/visitor-act";
import { resetAuth } from "../helpers/db";
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
    const results = await Promise.all([
      beginTurn(pool(), turn({ visitor: { text: "Bye", act: { ...ACT, act: "farewell" } }, ending: "farewell" })),
      beginTurn(pool(), turn({ visitor: { text: "Bye too", act: { ...ACT, act: "farewell" } }, ending: "farewell" })),
    ]);
    expect(results.map((r) => r.ok).sort()).toEqual([false, true]);
    expect(await messagesOf(CONV)).toHaveLength(2);
  });

  it("inserts nothing on Retry (no visitor message)", async () => {
    await beginTurn(pool(), turn());
    expect(await beginTurn(pool(), turn({ visitor: null }))).toEqual({ ok: true });
    expect(await messagesOf(CONV)).toHaveLength(1);
  });
});

describe("storeReply", () => {
  it("stores a finished reply with its trace and sources, and bumps updated_at", async () => {
    await beginTurn(pool(), turn());
    const before = (await conversationRow(CONV)).updated_at as Date;
    const toolCalls = [{ id: "t1", toolName: "search_biography", arguments: { query: "parity" }, status: "ok" as const, result: {}, durationMs: 5 }];
    const sources = [{ personaId: "wu", sectionHeading: "Parity", chunkId: 7 }];
    await storeReply(pool(), CONV, { message: { id: "x", role: "persona", text: "Parity fails.", toolCalls, sources, ended: "farewell" }, stopped: false });
    expect((await messagesOf(CONV))[1]).toEqual({ role: "persona", text: "Parity fails.", act: null, tool_calls: toolCalls, sources, ended: "farewell", stopped: false });
    expect(((await conversationRow(CONV)).updated_at as Date).getTime()).toBeGreaterThanOrEqual(before.getTime());
  });

  it("marks a partial reply as stopped", async () => {
    await beginTurn(pool(), turn());
    await storeReply(pool(), CONV, { message: { id: "x", role: "persona", text: "I was about to", toolCalls: [], sources: [] }, stopped: true });
    expect((await messagesOf(CONV))[1]).toMatchObject({ text: "I was about to", stopped: true, ended: null });
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
    expect(await findConversation(pool(), CONV)).toEqual({ id: CONV, userId: ana, personaSlug: "wu", personaName: "Chien-Shiung Wu", ended: "tired" });
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
    expect(list[0]).toEqual({ id: newer, personaId: "curie", personaName: "Marie Curie", preview: "Bonjour", updatedAt: expect.any(String), ended: "farewell" });
    expect(list[1].preview).toBe("First question");
  });
});

describe("readConversation", () => {
  it("returns the messages in the Message shape, act and stopped included", async () => {
    await seedConversation({ id: CONV, userId: ana, messages: [{ role: "user", text: "Hi", act: ACT }] });
    await storeReply(pool(), CONV, { message: { id: "x", role: "persona", text: "Half", toolCalls: [], sources: [] }, stopped: true });
    const c = await readConversation(pool(), ana, CONV);
    expect(c).toMatchObject({ id: CONV, personaId: "wu", personaName: "Chien-Shiung Wu", updatedAt: expect.any(String) });
    expect(c!.messages).toEqual([
      { id: expect.any(String), role: "user", text: "Hi", act: ACT },
      { id: expect.any(String), role: "persona", text: "Half", toolCalls: [], sources: [], stopped: true },
    ]);
  });

  it("is null for another user's conversation", async () => {
    await seedConversation({ id: CONV, userId: await insertUser("bo@example.com") });
    expect(await readConversation(pool(), ana, CONV)).toBeNull();
  });

  it("still reads after the persona is gone (no foreign key to personas)", async () => {
    await seedConversation({ id: CONV, userId: ana, personaSlug: "removed", personaName: "Someone Removed" });
    expect((await readConversation(pool(), ana, CONV))?.personaName).toBe("Someone Removed");
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
