import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { closePool, getPool } from "@corpus/db";
import { CostLedger, type ModelCallRecord } from "@corpus/cost-ledger";
import { approvedVoiceSlugs, findVoice, insertVoice } from "@/lib/server/persona-voices";
import type { VoiceDeps } from "@/lib/server/voice-deps";
import { NAME_WARNING } from "@/lib/server/voice-draft";
import { signInAs } from "../helpers/auth";
import { insertPersona, resetAuth, resetDb } from "../helpers/db";

const deps = vi.hoisted(() => ({ current: null as unknown }));
vi.mock("@/lib/server/voice-deps", () => ({ voiceDeps: () => deps.current }));

const route = await import("@/app/api/personas/[slug]/voice/route");
const sampleRoute = await import("@/app/api/personas/[slug]/voice/sample/route");

const helperCall: ModelCallRecord = { role: "helper", model: "h", inputTokens: 10, outputTokens: 5, cost: null, generationId: null, latencyMs: 1 };
const ttsCall: ModelCallRecord = { role: "tts", model: "t", inputTokens: 20, outputTokens: 64, cost: null, generationId: null, latencyMs: 1 };
const PCM = Buffer.alloc(480);

const draftFake = vi.fn<VoiceDeps["draftVoice"]>();
const speakFake = vi.fn<VoiceDeps["speak"]>();

let cookie = "";
let adminId = "";
let ledgerSeen: CostLedger | null = null;

beforeEach(async () => {
  const handler = CostLedger.prototype.handler;
  vi.spyOn(CostLedger.prototype, "handler").mockImplementation(function (this: CostLedger, role) {
    ledgerSeen = this;
    return handler.call(this, role);
  });
  await resetDb();
  await resetAuth();
  ({ cookie, userId: adminId } = await signInAs("boss@example.com", { role: "admin" }));
  draftFake.mockReset().mockImplementation(async (_p, callbacks) => {
    // The real model reports through the ledger handler; the fake records on the same ledger.
    expect(callbacks).toHaveLength(1);
    ledgerSeen?.record(helperCall);
    return { description: "An old woman, soft and precise.", baseVoice: "Algenib", sampleText: "Welcome, friend.", warning: null };
  });
  speakFake.mockReset().mockResolvedValue({ pcm: PCM, call: ttsCall });
  deps.current = {
    pool: getPool(),
    draftVoice: draftFake,
    speak: speakFake,
    resolveCosts: async (calls) => calls.map((c) => ({ ...c, cost: c.cost ?? 1, costSource: "estimated" as const })),
  } satisfies VoiceDeps;
  await insertPersona({ slug: "wu", displayName: "Chien-Shiung Wu" });
});
afterEach(() => vi.restoreAllMocks());
afterAll(() => closePool());

const ctx = (slug: string) => ({ params: Promise.resolve({ slug }) });
const req = (method: string, body?: unknown, as = cookie) =>
  new Request("http://localhost/api/personas/wu/voice", {
    method,
    headers: { cookie: as, "Content-Type": "application/json" },
    body: body === undefined ? undefined : typeof body === "string" ? body : JSON.stringify(body),
  });
const call = (method: "GET" | "POST" | "PATCH" | "DELETE", body?: unknown, slug = "wu", as = cookie) =>
  route[method](req(method, body, as), ctx(slug));
const sample = (slug = "wu", as = cookie) => sampleRoute.GET(req("GET", undefined, as), ctx(slug));
const loggedRoles = async () =>
  (await getPool().query("SELECT role, user_id, persona_slug FROM model_calls ORDER BY id")).rows;

describe("admin voice routes (spec §33.3)", () => {
  it("answers 404 to a tester on every method", async () => {
    const tester = await signInAs("t@example.com", { status: "approved" });
    for (const m of ["GET", "POST", "PATCH", "DELETE"] as const) {
      expect((await call(m, m === "PATCH" ? { render: true } : undefined, "wu", tester.cookie)).status).toBe(404);
    }
    expect((await sample("wu", tester.cookie)).status).toBe(404);
    expect(await findVoice(getPool(), "wu")).toBeNull();
    expect(draftFake).not.toHaveBeenCalled();
  });

  it("GET gives no voice and the voice languages; an unknown persona is 404", async () => {
    const res = await call("GET");
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ voice: null, voiceLanguages: ["en"] });
    const missing = await call("GET", undefined, "nobody");
    expect(missing.status).toBe(404);
    expect(await missing.json()).toEqual({ error: "No such persona." });
  });

  it("POST drafts a voice, renders the sample and logs a helper and a tts row", async () => {
    const res = await call("POST");
    expect(res.status).toBe(201);
    const { voice } = await res.json();
    expect(voice).toMatchObject({
      baseVoice: "Algenib",
      description: "An old woman, soft and precise.",
      sampleText: "Welcome, friend.",
      status: "draft",
      hasSample: true,
      sampleLanguage: "en",
      warning: null,
    });
    expect(speakFake).toHaveBeenCalledWith(expect.objectContaining({ text: "Welcome, friend.", voice: "Algenib" }));
    expect(await loggedRoles()).toEqual([
      { role: "helper", user_id: adminId, persona_slug: "wu" },
      { role: "tts", user_id: adminId, persona_slug: "wu" },
    ]);
    expect((await findVoice(getPool(), "wu"))?.sampleAudio?.subarray(0, 4).toString()).toBe("RIFF");
  });

  it("POST returns the draft's warning", async () => {
    draftFake.mockResolvedValueOnce({ description: "d", baseVoice: "Algenib", sampleText: "Hello Chien", warning: NAME_WARNING });
    expect((await (await call("POST")).json()).voice.warning).toBe(NAME_WARNING);
  });

  it("a second POST is 409 and spends nothing more", async () => {
    await call("POST");
    expect((await call("POST")).status).toBe(409);
    expect(draftFake).toHaveBeenCalledTimes(1);
  });

  it("POST for a persona with only Latin is 400 no_voice_languages", async () => {
    await getPool().query(`UPDATE personas SET languages = '[{"code":"la","name":"Latin","native":true}]'::jsonb WHERE slug = 'wu'`);
    const res = await call("POST");
    expect(res.status).toBe(400);
    expect((await res.json()).code).toBe("no_voice_languages");
    expect(draftFake).not.toHaveBeenCalled();
  });

  it("POST: a TTS failure is 502, keeps the draft and still logs what was spent", async () => {
    speakFake.mockRejectedValueOnce(new Error("boom"));
    vi.spyOn(console, "error").mockImplementation(() => {});
    const res = await call("POST");
    expect(res.status).toBe(502);
    expect(await res.json()).toEqual({ error: "Couldn't render the sample. Try again." });
    expect((await findVoice(getPool(), "wu"))?.sampleAudio).toBeNull();
    expect((await loggedRoles()).map((r) => r.role)).toEqual(["helper"]);
    const get = await (await call("GET")).json();
    expect(get.voice).toMatchObject({ hasSample: false, status: "draft" });
  });

  it("PATCH description sends an approved voice back to draft; render makes a new sample", async () => {
    await call("POST");
    await call("PATCH", { status: "approved" });
    const res = await call("PATCH", { description: "  A gruff old man.  " });
    expect((await res.json()).voice).toMatchObject({ status: "draft", description: "A gruff old man." });
    expect(speakFake).toHaveBeenCalledTimes(1);
    const rendered = await call("PATCH", { render: true });
    expect(rendered.status).toBe(200);
    expect(speakFake).toHaveBeenCalledTimes(2);
    expect(speakFake.mock.calls[1][0].instructions).toContain("A gruff old man.");
    expect((await loggedRoles()).map((r) => r.role)).toEqual(["helper", "tts", "tts"]);
  });

  it("an edit drops the stale sample, so approving needs a new render", async () => {
    await call("POST");
    const edited = await (await call("PATCH", { description: "A gruff old man." })).json();
    expect(edited.voice).toMatchObject({ status: "draft", hasSample: false });
    expect((await call("PATCH", { status: "approved" })).status).toBe(409);
    const rendered = await (await call("PATCH", { render: true })).json();
    expect(rendered.voice.hasSample).toBe(true);
    expect((await call("PATCH", { status: "approved" })).status).toBe(200);
  });

  it("an edit with render renders the new sample in the same request", async () => {
    await call("POST");
    const res = await (await call("PATCH", { baseVoice: "Iapetus", render: true })).json();
    expect(res.voice).toMatchObject({ baseVoice: "Iapetus", status: "draft", hasSample: true });
    expect((await call("PATCH", { status: "approved" })).status).toBe(200);
  });

  it("POST: a draft failure is 502, creates no voice and still logs the helper call", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    draftFake.mockImplementationOnce(async () => {
      ledgerSeen?.record(helperCall);
      throw new Error("bad draft");
    });
    const res = await call("POST");
    expect(res.status).toBe(502);
    expect(await res.json()).toEqual({ error: "Couldn't draft the voice. Try again." });
    expect(await findVoice(getPool(), "wu")).toBeNull();
    expect((await loggedRoles()).map((r) => r.role)).toEqual(["helper"]);
    expect(speakFake).not.toHaveBeenCalled();
  });

  it("PATCH render: a TTS failure is 502, keeps the edit and logs the spend", async () => {
    await call("POST");
    vi.spyOn(console, "error").mockImplementation(() => {});
    speakFake.mockImplementationOnce(async () => {
      ledgerSeen?.record(ttsCall);
      throw new Error("boom");
    });
    const res = await call("PATCH", { description: "A gruff old man.", render: true });
    expect(res.status).toBe(502);
    expect(await res.json()).toEqual({ error: "Couldn't render the sample. Try again." });
    expect(await findVoice(getPool(), "wu")).toMatchObject({ description: "A gruff old man.", status: "draft", sampleAudio: null });
    expect((await loggedRoles()).map((r) => r.role)).toEqual(["helper", "tts", "tts"]);
  });

  it("PATCH render with nothing changed keeps an approved status", async () => {
    await call("POST");
    await call("PATCH", { status: "approved" });
    expect((await (await call("PATCH", { render: true })).json()).voice.status).toBe("approved");
  });

  it("PATCH recomputes the name warning", async () => {
    await call("POST");
    const res = await call("PATCH", { description: "Like Chien, but older." });
    expect((await res.json()).voice.warning).toBe(NAME_WARNING);
  });

  it("PATCH approves a voice with a sample", async () => {
    await call("POST");
    const res = await call("PATCH", { status: "approved" });
    expect((await res.json()).voice.status).toBe("approved");
    expect(await approvedVoiceSlugs(getPool())).toContain("wu");
  });

  it("PATCH approve without a sample is 409", async () => {
    await insertVoice(getPool(), { personaSlug: "wu", baseVoice: "Algenib", description: "d", sampleText: "s" });
    expect((await call("PATCH", { status: "approved" })).status).toBe(409);
  });

  it("PATCH validates its body", async () => {
    await call("POST");
    for (const body of [
      { description: "x".repeat(601) },
      { description: "   " },
      { baseVoice: "Nobody" },
      { status: "approved", description: "new" },
      { status: "draft" },
      {},
      "{not json",
    ]) {
      expect((await call("PATCH", body)).status).toBe(400);
    }
    expect((await findVoice(getPool(), "wu"))?.description).toBe("An old woman, soft and precise.");
  });

  it("PATCH, DELETE and the sample answer 404 'No voice yet.' without a voice", async () => {
    for (const res of [await call("PATCH", { render: true }), await call("DELETE"), await sample()]) {
      expect(res.status).toBe(404);
    }
    expect(await (await call("PATCH", { render: true })).json()).toEqual({ error: "No voice yet." });
    expect((await call("PATCH", { render: true }, "nobody")).status).toBe(404);
  });

  it("DELETE removes the voice", async () => {
    await call("POST");
    expect((await call("DELETE")).status).toBe(204);
    expect(await findVoice(getPool(), "wu")).toBeNull();
  });

  it("GET sample returns the stored WAV, uncached", async () => {
    await call("POST");
    const res = await sample();
    expect(res.status).toBe(200);
    expect(res.headers.get("Content-Type")).toBe("audio/wav");
    expect(res.headers.get("Cache-Control")).toBe("no-store");
    expect(Buffer.from(await res.arrayBuffer()).subarray(0, 4).toString()).toBe("RIFF");
  });
});
