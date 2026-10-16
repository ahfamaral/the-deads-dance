import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import { closePool, getPool } from "@corpus/db";
import { loadPersonas } from "@/lib/server/load-personas";
import { insertVoice, approveVoice, setSample } from "@/lib/server/persona-voices";
import { insertPersona, resetDb } from "../helpers/db";

beforeEach(() => resetDb());
afterAll(() => closePool());

describe("loadPersonas", () => {
  it("maps ready personas to the app's shape", async () => {
    await insertPersona({ slug: "chien-shiung-wu", displayName: "Chien-Shiung Wu", origin: "curated" });
    const { personas, unavailable } = await loadPersonas({ admin: false });
    expect(unavailable).toBe(false);
    expect(personas).toEqual([
      { id: "chien-shiung-wu", name: "Chien-Shiung Wu", description: "", lifespan: "", origin: "curated", hidden: false, voiceLanguages: [], voiceStatus: null },
    ]);
  });

  // 2026-10-16: testers never see a hidden persona; the admin sees it, flagged.
  it("leaves hidden personas out for testers and keeps them for the admin", async () => {
    await insertPersona({ slug: "shown", origin: "curated" });
    await insertPersona({ slug: "tucked", origin: "curated" });
    await getPool().query("UPDATE personas SET hidden = true WHERE slug = 'tucked'");
    expect((await loadPersonas({ admin: false })).personas.map((p) => p.id)).toEqual(["shown"]);
    expect((await loadPersonas({ admin: true })).personas.map((p) => [p.id, p.hidden])).toEqual([
      ["shown", false],
      ["tucked", true],
    ]);
  });

  // Spec §33.4: the picker's voice icon. Only an approved voice offers languages; only the admin sees the status.
  it("lists the voice languages of an approved voice, and the status only for the admin", async () => {
    await insertPersona({ slug: "approved", origin: "curated" });
    await insertPersona({ slug: "drafted", origin: "curated" });
    await insertPersona({ slug: "mute", origin: "curated" });
    await getPool().query(
      `UPDATE personas SET languages = '[{"code":"de","name":"German","native":true},{"code":"en","name":"English","native":false},{"code":"la","name":"Latin","native":false}]'::jsonb WHERE slug IN ('approved','drafted')`,
    );
    const voice = { baseVoice: "Algenib", description: "Warm.", sampleText: "Hallo." };
    await insertVoice(getPool(), { personaSlug: "approved", ...voice });
    await setSample(getPool(), "approved", Buffer.from("wav"));
    await approveVoice(getPool(), "approved");
    await insertVoice(getPool(), { personaSlug: "drafted", ...voice });

    const tester = (await loadPersonas({ admin: false })).personas.map((p) => [p.id, p.voiceLanguages, p.voiceStatus]);
    expect(tester).toEqual([["approved", ["de", "en"], null], ["drafted", [], null], ["mute", [], null]]);
    const admin = (await loadPersonas({ admin: true })).personas.map((p) => [p.id, p.voiceLanguages, p.voiceStatus]);
    expect(admin).toEqual([["approved", ["de", "en"], "approved"], ["drafted", [], "draft"], ["mute", [], null]]);
  });

  it("reports unavailable instead of throwing when the database is down", async () => {
    const saved = process.env.DATABASE_URL;
    const quiet = vi.spyOn(console, "error").mockImplementation(() => {});
    await closePool();
    process.env.DATABASE_URL = "postgres://persona:persona@localhost:1/persona";
    try {
      expect(await loadPersonas({ admin: false })).toEqual({ personas: [], unavailable: true });
    } finally {
      await closePool();
      process.env.DATABASE_URL = saved;
      quiet.mockRestore();
    }
  });
});
