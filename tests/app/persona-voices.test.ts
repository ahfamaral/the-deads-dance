import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { closePool, getPool } from "@corpus/db";
import { MODEL_CALL_ROLES } from "@corpus/cost-ledger";
import {
  approveVoice,
  approvedVoiceSlugs,
  deleteVoice,
  findVoice,
  insertVoice,
  setSample,
  updateVoice,
  voiceStatuses,
} from "@/lib/server/persona-voices";
import { insertPersona, resetDb } from "../helpers/db";
import { insertUser, seedConversation } from "../helpers/conversations";

const V = { personaSlug: "wu", baseVoice: "Algenib", description: "An old woman, soft and precise.", sampleText: "Welcome, friend." };
const db = () => getPool();

beforeEach(async () => {
  await resetDb();
  await insertPersona({ slug: "wu" });
});
afterAll(() => closePool());

describe("persona voices (spec §33.2)", () => {
  it("inserts once; a second insert reports false", async () => {
    expect(await insertVoice(db(), V)).toBe(true);
    expect(await insertVoice(db(), { ...V, baseVoice: "Iapetus" })).toBe(false);
    const v = await findVoice(db(), "wu");
    expect(v).toMatchObject({ personaSlug: "wu", baseVoice: "Algenib", sampleText: "Welcome, friend.", sampleAudio: null, status: "draft" });
    expect(await findVoice(db(), "nobody")).toBeNull();
  });

  it("approves only with a sample, and lists approved slugs and statuses", async () => {
    expect(await approveVoice(db(), "wu")).toBe(false);
    await insertVoice(db(), V);
    expect(await approveVoice(db(), "wu")).toBe(false);
    await setSample(db(), "wu", Buffer.from([1, 2, 3]));
    expect((await findVoice(db(), "wu"))?.sampleAudio).toEqual(Buffer.from([1, 2, 3]));
    expect(await voiceStatuses(db())).toEqual(new Map([["wu", "draft"]]));
    expect(await approvedVoiceSlugs(db())).toEqual(new Set());
    expect(await approveVoice(db(), "wu")).toBe(true);
    expect(await approvedVoiceSlugs(db())).toEqual(new Set(["wu"]));
    expect(await voiceStatuses(db())).toEqual(new Map([["wu", "approved"]]));
  });

  it("an edit puts an approved voice back to draft", async () => {
    await insertVoice(db(), V);
    await setSample(db(), "wu", Buffer.from([1]));
    await approveVoice(db(), "wu");
    expect(await updateVoice(db(), "wu", { description: "Deeper." })).toBe(true);
    const v = await findVoice(db(), "wu");
    expect(v).toMatchObject({ status: "draft", description: "Deeper.", baseVoice: "Algenib" });
    const { rows } = await db().query(`SELECT approved_at FROM persona_voices WHERE persona_slug = 'wu'`);
    expect(rows[0].approved_at).toBeNull();
    expect(await updateVoice(db(), "nobody", { baseVoice: "X" })).toBe(false);
  });

  it("deletes a voice, and deleting the persona cascades", async () => {
    await insertVoice(db(), V);
    expect(await deleteVoice(db(), "wu")).toBe(true);
    expect(await deleteVoice(db(), "wu")).toBe(false);
    await insertVoice(db(), V);
    await db().query(`DELETE FROM personas WHERE slug = 'wu'`);
    expect(await findVoice(db(), "wu")).toBeNull();
  });

  it("accepts the tts role in the ledger and the schema", async () => {
    expect(MODEL_CALL_ROLES).toContain("tts");
    const userId = await insertUser("tts@example.com");
    await db().query(
      `INSERT INTO model_calls (user_id, role, model, cost, cost_source) VALUES ($1, 'tts', 'google/gemini-3.8-flash-tts', 5, 'estimated')`,
      [userId],
    );
  });

  it("a new conversation is text mode with no voice language", async () => {
    const userId = await insertUser("mode@example.com");
    const id = await seedConversation({ userId });
    const { rows } = await db().query(`SELECT mode, voice_language FROM conversations WHERE id = $1`, [id]);
    expect(rows[0]).toEqual({ mode: "text", voice_language: null });
  });
});
