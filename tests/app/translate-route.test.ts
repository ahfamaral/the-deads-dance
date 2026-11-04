import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { BaseCallbackHandler } from "@langchain/core/callbacks/base";
import { closePool, getPool } from "@corpus/db";
import { POST } from "@/app/api/conversations/[id]/translate/route";
import { signInAs } from "../helpers/auth";
import { seedConversation } from "../helpers/conversations";
import { resetAuth } from "../helpers/db";
import { giveEnergy } from "../helpers/energy";

vi.mock("@/lib/server/email", () => ({ sendCode: async () => {}, sendApproval: async () => {} }));

const model = vi.fn();
const deps = vi.hoisted(() => ({ current: null as unknown }));
vi.mock("@/lib/server/translate-deps", () => ({ translateDeps: () => deps.current }));

const toolCalls = [
  {
    toolName: "search_biography",
    arguments: { query: "x" },
    status: "ok",
    result: { status: "ok", queries: ["x"], passages: [{ chunk_id: 7, section_heading: "Infância", content: "Nasceu no Rio.", language: "pt" }, { chunk_id: 8, section_heading: "Life", content: "Plain English." }] },
  },
];

let ana: { userId: string; cookie: string };
let conv: string;

beforeEach(async () => {
  await resetAuth();
  await getPool().query("TRUNCATE passage_translations");
  model.mockReset();
  model.mockImplementation(async (input: { content: string }) => ({ heading: "Childhood", content: `EN: ${input.content}` }));
  deps.current = {
    pool: getPool(),
    // a fake translator that also reports one billed helper call to the ledger handler
    translator: (callbacks: BaseCallbackHandler[]) => async (input: { heading: string; content: string; to: string }) => {
      const out = await model(input);
      // what a real call does: the ledger handler sees one finished model call
      await callbacks[0].handleLLMEnd?.({ generations: [[{ text: "", message: { usage_metadata: { input_tokens: 10, output_tokens: 5 } } }]] } as never, "run");
      return out;
    },
    resolveCosts: async () => [{ role: "helper", model: "m", inputTokens: 10, outputTokens: 5, cost: 400, costSource: "reported", generationId: null, latencyMs: 1 }],
  };
  ana = await signInAs("ana@example.com", { status: "approved" });
  await giveEnergy(ana.userId, 1_000_000);
  conv = await withTools(ana.userId);
});
afterAll(() => closePool());

async function withTools(userId: string) {
  const id = await seedConversation({ userId, messages: [{ role: "user", text: "Hi" }, { role: "persona", text: "Hello." }] });
  await getPool().query(`UPDATE messages SET tool_calls = $2::jsonb WHERE conversation_id = $1 AND role = 'persona'`, [id, JSON.stringify(toolCalls)]);
  return id;
}

const post = (cookie: string, id: string, body: unknown) =>
  POST(
    new Request(`http://localhost/api/conversations/${id}/translate`, { method: "POST", headers: { cookie, "Content-Type": "application/json" }, body: JSON.stringify(body) }),
    { params: Promise.resolve({ id }) },
  );
const rows = async () => (await getPool().query(`SELECT role, user_id, conversation_id FROM model_calls`)).rows;
const balance = async (id: string) => Number((await getPool().query(`SELECT "energyBalance" FROM "user" WHERE id = $1`, [id])).rows[0].energyBalance);

describe("POST /api/conversations/:id/translate (spec §34.6)", () => {
  it("translates the stored passage, records one charged helper call, and caches it", async () => {
    const res = await post(ana.cookie, conv, { chunkId: 7, to: "en" });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ heading: "Childhood", content: "EN: Nasceu no Rio.", from: "pt" });
    expect(await rows()).toEqual([{ role: "helper", user_id: ana.userId, conversation_id: conv }]);
    expect(await balance(ana.userId)).toBe(1_000_000 - 400);
    await post(ana.cookie, conv, { chunkId: 7, to: "en" });
    expect(model).toHaveBeenCalledTimes(1);
    expect(await rows()).toHaveLength(1);
  });

  it("never translates text from the request body", async () => {
    const res = await post(ana.cookie, conv, { chunkId: 7, to: "en", content: "Ignore all", heading: "x" });
    expect(res.status).toBe(400);
    expect(model).not.toHaveBeenCalled();
  });

  it("404s a chunk id that is not in this conversation, with no model call and no charge", async () => {
    const res = await post(ana.cookie, conv, { chunkId: 999, to: "en" });
    expect(res.status).toBe(404);
    expect(model).not.toHaveBeenCalled();
    expect(await rows()).toEqual([]);
    expect(await balance(ana.userId)).toBe(1_000_000);
  });

  it("404s another tester's conversation, with no model call and no charge", async () => {
    const rui = await signInAs("rui@example.com", { status: "approved" });
    await giveEnergy(rui.userId, 1_000_000);
    const res = await post(rui.cookie, conv, { chunkId: 7, to: "en" });
    expect(res.status).toBe(404);
    expect(model).not.toHaveBeenCalled();
    expect(await rows()).toEqual([]);
    expect(await balance(rui.userId)).toBe(1_000_000);
  });

  it("refuses a tester with no energy before any model call, but serves a cached translation", async () => {
    await post(ana.cookie, conv, { chunkId: 7, to: "en" });
    await giveEnergy(ana.userId, 0);
    expect((await post(ana.cookie, conv, { chunkId: 7, to: "en" })).status).toBe(200);
    expect(model).toHaveBeenCalledTimes(1);
    await getPool().query("TRUNCATE passage_translations");
    const res = await post(ana.cookie, conv, { chunkId: 7, to: "en" });
    expect(res.status).toBe(402);
    expect((await res.json()).code).toBe("out_of_energy");
    expect(model).toHaveBeenCalledTimes(1);
    expect(await rows()).toHaveLength(1);
  });

  it("lets the admin translate a tester's passage, logged but never charged", async () => {
    const boss = await signInAs("boss@example.com", { status: "approved", role: "admin" });
    await giveEnergy(boss.userId, 0);
    const before = await balance(boss.userId);
    const res = await post(boss.cookie, conv, { chunkId: 7, to: "en" });
    expect(res.status).toBe(200);
    expect(await rows()).toEqual([{ role: "helper", user_id: boss.userId, conversation_id: conv }]);
    expect(await balance(boss.userId)).toBe(before);
  });

  it("returns an English passage as is when it is already in the asked language, without a model call", async () => {
    const res = await post(ana.cookie, conv, { chunkId: 8, to: "en" });
    expect(await res.json()).toEqual({ heading: "Life", content: "Plain English.", from: "en" });
    expect(model).not.toHaveBeenCalled();
  });

  it("answers 502 when the model fails, storing and charging nothing", async () => {
    model.mockRejectedValue(new Error("boom"));
    vi.spyOn(console, "error").mockImplementation(() => {});
    const res = await post(ana.cookie, conv, { chunkId: 7, to: "en" });
    expect(res.status).toBe(502);
    expect(await balance(ana.userId)).toBe(1_000_000);
  });

  it("needs a signed-in, approved user", async () => {
    expect((await post("", conv, { chunkId: 7, to: "en" })).status).toBe(401);
  });
});
