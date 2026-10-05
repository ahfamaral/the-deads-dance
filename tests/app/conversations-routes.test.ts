import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import { closePool } from "@corpus/db";
import { GET as list } from "@/app/api/conversations/route";
import { DELETE as remove, GET as read } from "@/app/api/conversations/[id]/route";
import { getAuth } from "@/lib/server/auth";
import type { VisitorAct } from "@/lib/visitor-act";
import { signInAs } from "../helpers/auth";
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
    expect(conversations).toEqual([{ id: mine, personaId: "wu", personaName: "Chien-Shiung Wu", preview: "Hi", updatedAt: expect.any(String), ended: null }]);
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
