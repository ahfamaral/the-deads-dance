import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { closePool, getPool } from "@corpus/db";
import { deleteConversation } from "@/lib/server/conversations";
import { listFeedback, saveFeedback, type SaveFeedback } from "@/lib/server/feedback";
import type { VisitorAct } from "@/lib/visitor-act";
import { resetAuth } from "../helpers/db";
import { insertUser, seedConversation } from "../helpers/conversations";

const ACT: VisitorAct = { act: "question", offense: 0, sorePoint: false, language: "en", wants: "normal", visitorName: null };
const pool = () => getPool();
const row = async (id: string) =>
  (await pool().query(`SELECT stars, comment, model, commit_sha, created_at, updated_at FROM conversation_feedback WHERE conversation_id = $1`, [id])).rows[0];

let ana: string;
let conv: string;
beforeEach(async () => {
  await resetAuth(); // TRUNCATE "user" CASCADE also clears conversations and feedback
  ana = await insertUser("ana@example.com");
  conv = await seedConversation({ userId: ana, messages: [{ role: "user", text: "Hi", act: ACT }, { role: "persona", text: "Hello." }] });
});
afterAll(() => closePool());

const save = (over: Partial<SaveFeedback> = {}) =>
  saveFeedback(pool(), { conversationId: conv, userId: ana, stars: 4, comment: "Good", model: "anthropic/claude-haiku-5.5", commitSha: "abc123", ...over });

describe("saveFeedback (spec §32.2–3)", () => {
  it("stores the first rating with its config", async () => {
    expect(await save()).toEqual({ ok: true, feedback: { stars: 4, comment: "Good" } });
    expect(await row(conv)).toMatchObject({ stars: 4, comment: "Good", model: "anthropic/claude-haiku-5.5", commit_sha: "abc123" });
  });

  it("replaces stars and comment on an edit, keeping model, commit_sha and created_at", async () => {
    await save();
    const first = await row(conv);
    expect(await save({ stars: 2, comment: "", model: "other/model", commitSha: "def456" })).toEqual({ ok: true, feedback: { stars: 2, comment: "" } });
    const edited = await row(conv);
    expect(edited).toMatchObject({ stars: 2, comment: "", model: "anthropic/claude-haiku-5.5", commit_sha: "abc123" });
    expect(edited.created_at).toEqual(first.created_at);
    expect(edited.updated_at.getTime()).toBeGreaterThan(first.updated_at.getTime());
  });

  // Review Focus 4: only the owner rates, the admin included.
  it("refuses someone else's conversation as not_found, and stores nothing", async () => {
    const bo = await insertUser("bo@example.com");
    expect(await save({ userId: bo })).toEqual({ ok: false, reason: "not_found" });
    expect(await row(conv)).toBeUndefined();
  });

  it("refuses a missing conversation as not_found", async () => {
    expect(await save({ conversationId: crypto.randomUUID() })).toEqual({ ok: false, reason: "not_found" });
  });

  it("refuses a conversation with no visitor message", async () => {
    const empty = await seedConversation({ userId: ana, messages: [{ role: "persona", text: "Hello." }] });
    expect(await save({ conversationId: empty })).toEqual({ ok: false, reason: "no_messages" });
    expect(await row(empty)).toBeUndefined();
  });

  // Review Focus 3: hard delete takes the rating with it.
  it("goes with the conversation when it's deleted", async () => {
    await save();
    expect(await deleteConversation(pool(), ana, conv)).toBe(true);
    expect(await row(conv)).toBeUndefined();
    expect((await listFeedback(pool())).items).toEqual([]);
  });
});

describe("listFeedback (spec §32.3, §32.7)", () => {
  it("is empty with no ratings", async () => {
    expect(await listFeedback(pool())).toEqual({ summary: { count: 0, average: null, perPersona: [] }, items: [] });
  });

  it("lists every rating newest first, with the tester's email, the persona and edited", async () => {
    await save({ stars: 5, comment: "Great" });
    const bo = await insertUser("bo@example.com");
    const other = await seedConversation({ userId: bo, personaSlug: "curie", personaName: "Marie Curie", messages: [{ role: "user", text: "Bonjour", act: ACT }] });
    await saveFeedback(pool(), { conversationId: other, userId: bo, stars: 2, comment: "", model: "m", commitSha: "dev" });
    await saveFeedback(pool(), { conversationId: other, userId: bo, stars: 3, comment: "Better", model: "m", commitSha: "dev" });

    const report = await listFeedback(pool());
    expect(report.items).toEqual([
      { conversationId: other, stars: 3, comment: "Better", email: "bo@example.com", personaName: "Marie Curie", createdAt: expect.any(String), edited: true },
      { conversationId: conv, stars: 5, comment: "Great", email: "ana@example.com", personaName: "Chien-Shiung Wu", createdAt: expect.any(String), edited: false },
    ]);
    expect(report.summary).toEqual({
      count: 2,
      average: 4,
      perPersona: [
        { personaName: "Chien-Shiung Wu", count: 1, average: 5 },
        { personaName: "Marie Curie", count: 1, average: 3 },
      ],
    });
  });
});
