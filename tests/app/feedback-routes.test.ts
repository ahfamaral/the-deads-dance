import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { closePool, getPool } from "@corpus/db";
import { DEFAULT_MODELS } from "@corpus/models";
import { PUT } from "@/app/api/conversations/[id]/feedback/route";
import { GET as ADMIN_FEEDBACK } from "@/app/api/admin/feedback/route";
import { getAuth } from "@/lib/server/auth";
import type { VisitorAct } from "@/lib/visitor-act";
import { signInAs } from "../helpers/auth";
import { seedConversation } from "../helpers/conversations";
import { resetAuth } from "../helpers/db";

vi.mock("@/lib/server/email", () => ({ sendCode: async () => {}, sendApproval: async () => {} }));

const ACT: VisitorAct = { act: "question", offense: 0, sorePoint: false, language: "en", wants: "normal", visitorName: null };
const GONE = { error: "This conversation is no longer available.", code: "unknown_conversation" };
let ana: { userId: string; cookie: string };
let conv: string;

beforeEach(async () => {
  await resetAuth();
  ana = await signInAs("ana@example.com", { status: "approved" });
  conv = await seedConversation({ userId: ana.userId, messages: [{ role: "user", text: "Hi", act: ACT }, { role: "persona", text: "Hello." }] });
});
afterEach(() => vi.unstubAllEnvs());
afterAll(() => closePool());

const put = (cookie: string, id: string, body: unknown) =>
  PUT(
    new Request(`http://localhost/api/conversations/${id}/feedback`, {
      method: "PUT",
      headers: { cookie, "Content-Type": "application/json" },
      body: typeof body === "string" ? body : JSON.stringify(body),
    }),
    { params: Promise.resolve({ id }) },
  );
const stored = async (id: string) => (await getPool().query(`SELECT model, commit_sha FROM conversation_feedback WHERE conversation_id = $1`, [id])).rows[0];

describe("PUT /api/conversations/:id/feedback (spec §32.3)", () => {
  it("saves your rating with the agent model and 'dev' when no commit is set", async () => {
    vi.stubEnv("AGENT_MODEL", "");
    vi.stubEnv("VERCEL_GIT_COMMIT_SHA", "");
    const res = await put(ana.cookie, conv, { stars: 4, comment: "  Good  " });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ feedback: { stars: 4, comment: "Good" } });
    expect(await stored(conv)).toEqual({ model: DEFAULT_MODELS.agent, commit_sha: "dev" });
  });

  it("records the deployed commit and the configured model", async () => {
    vi.stubEnv("AGENT_MODEL", "some/model");
    vi.stubEnv("VERCEL_GIT_COMMIT_SHA", "abc123");
    await put(ana.cookie, conv, { stars: 5 });
    expect(await stored(conv)).toEqual({ model: "some/model", commit_sha: "abc123" });
  });

  it("refuses bad input with 400 and stores nothing", async () => {
    for (const body of [{ stars: 0 }, { stars: 4, comment: "x".repeat(201) }, {}]) {
      const res = await put(ana.cookie, conv, body);
      expect(res.status).toBe(400);
      expect((await res.json()).code).toBe("invalid_feedback");
    }
    expect(await stored(conv)).toBeUndefined();
  });

  // Review Focus 5: never a 503 for a bad request.
  it("answers 400 for a body that isn't JSON, and 404 for an id that isn't a uuid", async () => {
    expect((await put(ana.cookie, conv, "{not json")).status).toBe(400);
    const res = await put(ana.cookie, "not-a-uuid", { stars: 4 });
    expect(res.status).toBe(404);
    expect(await res.json()).toEqual(GONE);
  });

  // Review Focus 4: the admin reads anyone's, but rates only their own.
  it("answers 404 for someone else's conversation, the admin's included", async () => {
    const boss = await signInAs("boss@example.com", { role: "admin" });
    const res = await put(boss.cookie, conv, { stars: 1 });
    expect(res.status).toBe(404);
    expect(await res.json()).toEqual(GONE);
    expect(await stored(conv)).toBeUndefined();
  });

  it("answers 400 no_messages when there's nothing to rate", async () => {
    const empty = await seedConversation({ userId: ana.userId, messages: [] });
    const res = await put(ana.cookie, empty, { stars: 3 });
    expect(res.status).toBe(400);
    expect((await res.json()).code).toBe("no_messages");
  });

  it("answers 401 signed out and 403 not approved", async () => {
    expect((await put("", conv, { stars: 3 })).status).toBe(401);
    const blocked = await signInAs("b@example.com", { status: "blocked" });
    expect((await put(blocked.cookie, conv, { stars: 3 })).status).toBe(403);
  });

  it("answers 503 when the database is down", async () => {
    const spy = vi.spyOn(getAuth().api, "getSession").mockRejectedValueOnce(new Error("connect ECONNREFUSED 127.0.0.1:5433"));
    const quiet = vi.spyOn(console, "error").mockImplementation(() => {});
    expect((await put(ana.cookie, conv, { stars: 3 })).status).toBe(503);
    spy.mockRestore();
    quiet.mockRestore();
  });
});

describe("GET /api/admin/feedback (spec §32.3)", () => {
  const get = (cookie: string) => ADMIN_FEEDBACK(new Request("http://localhost/api/admin/feedback", { headers: { cookie } }));

  it("is hidden (404) from everyone but the admin", async () => {
    expect((await get(ana.cookie)).status).toBe(404);
    expect((await get("")).status).toBe(404);
  });

  it("gives the admin every rating and the summary", async () => {
    await put(ana.cookie, conv, { stars: 4, comment: "Good" });
    const boss = await signInAs("boss@example.com", { role: "admin" });
    const res = await get(boss.cookie);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      summary: { count: 1, average: 4, perPersona: [{ personaName: "Chien-Shiung Wu", count: 1, average: 4 }] },
      items: [{ conversationId: conv, stars: 4, comment: "Good", email: "ana@example.com", personaName: "Chien-Shiung Wu", createdAt: expect.any(String), edited: false }],
    });
  });
});
