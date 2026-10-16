import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import { closePool, getPool } from "@corpus/db";
import { GET as list } from "@/app/api/conversations/route";
import { DELETE as remove, GET as read } from "@/app/api/conversations/[id]/route";
import { settleTurn } from "@/lib/server/conversations";
import { getAuth } from "@/lib/server/auth";
import type { VisitorAct } from "@/lib/visitor-act";
import { signInAs, withCookie } from "../helpers/auth";
import { conversationRow, seedConversation } from "../helpers/conversations";
import { resetAuth } from "../helpers/db";

const ACT: VisitorAct = { act: "question", offense: 0, sorePoint: false, language: "en", wants: "normal", visitorName: null };
const GONE = { error: "This conversation is no longer available.", code: "unknown_conversation" };
let ana: { userId: string; cookie: string };

beforeEach(async () => {
  await resetAuth();
  ana = await signInAs("ana@example.com", { status: "approved" });
});
afterAll(() => closePool());

const req = (cookie: string, method = "GET") => new Request("http://localhost/api/conversations", { method, headers: { cookie } });
const params = (id: string) => ({ params: Promise.resolve({ id }) });

describe("GET /api/conversations", () => {
  it("lists only your own conversations, as summaries", async () => {
    const mine = await seedConversation({ userId: ana.userId, messages: [{ role: "user", text: "Hi", act: ACT }] });
    const bo = await signInAs("bo@example.com", { status: "approved" });
    await seedConversation({ userId: bo.userId, messages: [{ role: "user", text: "Not yours", act: ACT }] });
    const res = await list(req(ana.cookie));
    expect(res.status).toBe(200);
    const { conversations } = await res.json();
    expect(conversations).toEqual([{ id: mine, personaId: "wu", personaName: "Chien-Shiung Wu", preview: "Hi", updatedAt: expect.any(String), ended: null, stars: null, voiceLanguage: null }]);
  });

  // Review Focus 5: signed out, or not approved.
  it("answers 401 signed out and 403 not approved", async () => {
    expect((await list(req(""))).status).toBe(401);
    const pending = await signInAs("p@example.com", { status: "pending" });
    expect((await list(req(pending.cookie))).status).toBe(403);
  });

  it("answers 503 when the database is down", async () => {
    const spy = vi.spyOn(getAuth().api, "getSession").mockRejectedValueOnce(new Error("connect ECONNREFUSED 127.0.0.1:5433"));
    const quiet = vi.spyOn(console, "error").mockImplementation(() => {});
    expect((await list(req(ana.cookie))).status).toBe(503);
    spy.mockRestore();
    quiet.mockRestore();
  });
});

describe("GET and DELETE /api/conversations/:id", () => {
  it("returns your conversation with its messages", async () => {
    const id = await seedConversation({ userId: ana.userId, messages: [{ role: "user", text: "Hi", act: ACT }, { role: "persona", text: "Hello." }] });
    const res = await read(req(ana.cookie), params(id));
    expect(res.status).toBe(200);
    const { conversation } = await res.json();
    expect(conversation.messages.map((m: { text: string }) => m.text)).toEqual(["Hi", "Hello."]);
  });

  it("answers 404 for someone else's conversation, a missing one, and a malformed id", async () => {
    const bo = await signInAs("bo@example.com", { status: "approved" });
    const theirs = await seedConversation({ userId: bo.userId });
    // Review Focus 1: "not-a-uuid" must be a 404, not a 503 from Postgres' uuid cast.
    for (const id of [theirs, crypto.randomUUID(), "not-a-uuid"]) {
      const got = await read(req(ana.cookie), params(id));
      expect(got.status).toBe(404);
      expect(await got.json()).toEqual(GONE);
      expect((await remove(req(ana.cookie, "DELETE"), params(id))).status).toBe(404);
    }
    expect(await conversationRow(theirs)).toBeDefined();
  });

  it("hard-deletes your conversation with 204", async () => {
    const id = await seedConversation({ userId: ana.userId, messages: [{ role: "user", text: "Hi", act: ACT }] });
    const res = await remove(req(ana.cookie, "DELETE"), params(id));
    expect(res.status).toBe(204);
    expect(await conversationRow(id)).toBeUndefined();
  });

  it("answers 401 signed out", async () => {
    const id = await seedConversation({ userId: ana.userId });
    expect((await read(req(""), params(id))).status).toBe(401);
    expect((await remove(req("", "DELETE"), params(id))).status).toBe(401);
  });
});

describe("costs in a conversation read (spec §26.5–6)", () => {
  const settled = async (userId: string) => {
    const id = await seedConversation({ userId, messages: [{ role: "user", text: "hi" }] });
    await settleTurn(getPool(), {
      conversationId: id, userId, charge: false,
      reply: { id: "r", role: "persona", text: "Hello.", toolCalls: [], sources: [] },
      calls: [{ role: "agent", model: "m", inputTokens: 900, outputTokens: 100, cost: 30_000, costSource: "reported", generationId: null, latencyMs: 1 }],
    });
    return id;
  };
  const get = (cookie: string, id: string) =>
    read(new Request(`http://localhost/api/conversations/${id}`, withCookie(cookie)), { params: Promise.resolve({ id }) } as never);

  it("never sends a tester costs", async () => {
    const { cookie, userId } = await signInAs("tess@example.com", { status: "approved" });
    const body = JSON.stringify(await (await get(cookie, await settled(userId))).json());
    expect(body).not.toMatch(/"cost"|"tokens"|"spend"/);
    expect(body).toContain('"turnRunning":false');
  });

  it("sends the admin the totals and each reply's cost", async () => {
    const { cookie, userId } = await signInAs("boss@example.com", { role: "admin" });
    const { conversation } = await (await get(cookie, await settled(userId))).json();
    expect(conversation.spend).toEqual({ tokens: 1_000, cost: 30_000 });
    expect(conversation.messages.at(-1)).toMatchObject({ cost: 30_000, tokens: 1_000 });
  });
});

describe("the admin reads every conversation (spec §27)", () => {
  it("lists everyone's conversations for the admin, with email and mine", async () => {
    const boss = await signInAs("boss@example.com", { role: "admin" });
    const hers = await seedConversation({ userId: ana.userId, messages: [{ role: "user", text: "hi" }] });
    const { conversations } = await (await list(req(boss.cookie))).json();
    expect(conversations).toEqual([expect.objectContaining({ id: hers, userEmail: "ana@example.com", mine: false })]);
  });

  it("lets the admin read another user's conversation, with its email, but not delete it", async () => {
    const boss = await signInAs("boss@example.com", { role: "admin" });
    const hers = await seedConversation({ userId: ana.userId, messages: [{ role: "user", text: "hi" }] });
    const res = await read(req(boss.cookie), params(hers));
    expect(res.status).toBe(200);
    expect((await res.json()).conversation).toMatchObject({ id: hers, userEmail: "ana@example.com" });
    const del = await remove(req(boss.cookie, "DELETE"), params(hers));
    expect(del.status).toBe(404);
    expect(await del.json()).toEqual(GONE);
    expect((await read(req(ana.cookie), params(hers))).status).toBe(200); // still there
  });

  it("never sends a tester userEmail or mine, and still hides others' conversations", async () => {
    const boss = await signInAs("boss@example.com", { role: "admin" });
    const bossConv = await seedConversation({ userId: boss.userId });
    await seedConversation({ userId: ana.userId, messages: [{ role: "user", text: "hi" }] });
    const body = JSON.stringify(await (await list(req(ana.cookie))).json());
    expect(body).not.toMatch(/userEmail|"mine"/);
    expect((await read(req(ana.cookie), params(bossConv))).status).toBe(404);
  });
});
