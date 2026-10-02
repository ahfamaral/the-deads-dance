import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import { closePool } from "@corpus/db";
import { loadPersonas } from "@/lib/server/load-personas";
import { insertPersona, resetDb } from "../helpers/db";

beforeEach(() => resetDb());
afterAll(() => closePool());

describe("loadPersonas", () => {
  it("maps ready personas to the app's shape", async () => {
    await insertPersona({ slug: "chien-shiung-wu", displayName: "Chien-Shiung Wu", origin: "curated" });
    const { personas, unavailable } = await loadPersonas();
    expect(unavailable).toBe(false);
    expect(personas).toEqual([
      { id: "chien-shiung-wu", name: "Chien-Shiung Wu", description: "", lifespan: "", origin: "curated" },
    ]);
  });

  it("reports unavailable instead of throwing when the database is down", async () => {
    const saved = process.env.DATABASE_URL;
    const quiet = vi.spyOn(console, "error").mockImplementation(() => {});
    await closePool();
    process.env.DATABASE_URL = "postgres://persona:persona@localhost:1/persona";
    try {
      expect(await loadPersonas()).toEqual({ personas: [], unavailable: true });
    } finally {
      await closePool();
      process.env.DATABASE_URL = saved;
      quiet.mockRestore();
    }
  });
});
