import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import { closePool, getPool } from "@corpus/db";
import { loadPersonas } from "@/lib/server/load-personas";
import { insertPersona, resetDb } from "../helpers/db";

beforeEach(() => resetDb());
afterAll(() => closePool());

describe("loadPersonas", () => {
  it("maps ready personas to the app's shape", async () => {
    await insertPersona({ slug: "chien-shiung-wu", displayName: "Chien-Shiung Wu", origin: "curated" });
    const { personas, unavailable } = await loadPersonas({ admin: false });
    expect(unavailable).toBe(false);
    expect(personas).toEqual([
      { id: "chien-shiung-wu", name: "Chien-Shiung Wu", description: "", lifespan: "", origin: "curated", hidden: false },
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
