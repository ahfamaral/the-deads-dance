import { afterAll, describe, expect, it } from "vitest";
import { closePool, getPool } from "../../corpus/db";
import { applySchema } from "../../corpus/schema";

afterAll(() => closePool());

describe("schema", () => {
  it("applies twice without error", async () => {
    await applySchema(getPool());
    await applySchema(getPool());
  });

  it("has pgvector 0.8 or newer, which iterative HNSW scans need", async () => {
    const { rows } = await getPool().query("SELECT extversion FROM pg_extension WHERE extname = 'vector'");
    const [major, minor] = rows[0].extversion.split(".").map(Number);
    expect(major > 0 || minor >= 8).toBe(true);
  });

  it("has the profile columns and no system_prompt column", async () => {
    await applySchema(getPool());
    const { rows } = await getPool().query(
      "SELECT column_name, data_type FROM information_schema.columns WHERE table_name = 'personas'",
    );
    const columns = Object.fromEntries(rows.map((r) => [r.column_name, r.data_type]));
    expect(columns.profile).toBe("jsonb");
    expect(columns.profile_stamp).toBe("text");
    expect(columns.system_prompt).toBeUndefined();
  });

  it("migrates a database created before the profile columns", async () => {
    const pool = getPool();
    await pool.query("ALTER TABLE personas DROP COLUMN IF EXISTS profile, DROP COLUMN IF EXISTS profile_stamp");
    await pool.query("ALTER TABLE personas ADD COLUMN IF NOT EXISTS system_prompt text");
    await applySchema(pool);
    const { rows } = await pool.query(
      "SELECT column_name FROM information_schema.columns WHERE table_name = 'personas' AND column_name IN ('profile', 'profile_stamp', 'system_prompt')",
    );
    expect(rows.map((r) => r.column_name).sort()).toEqual(["profile", "profile_stamp"]);
  });

  it("deletes a persona's chunks with it", async () => {
    const pool = getPool();
    await pool.query("TRUNCATE personas RESTART IDENTITY CASCADE");
    const { rows } = await pool.query(
      "INSERT INTO personas (slug, display_name, wikipedia_title, origin, status) VALUES ('x', 'X', 'X', 'user', 'ready') RETURNING id",
    );
    await pool.query(
      `INSERT INTO chunks (persona_id, section_heading, ordinal, content, embedding)
       VALUES ($1, 'H', 0, 'c', array_fill(0.1, ARRAY[1536])::vector)`,
      [rows[0].id],
    );
    await pool.query("DELETE FROM personas WHERE slug = 'x'");
    const { rows: left } = await pool.query("SELECT count(*)::int AS n FROM chunks");
    expect(left[0].n).toBe(0);
  });

  it("corrects Max Planck's languages from the old seed (a deprecated Wikidata claim), and nothing else", async () => {
    const pool = getPool();
    await pool.query("TRUNCATE personas RESTART IDENTITY CASCADE");
    const bad = JSON.stringify([{ code: "es", name: "Spanish", native: true }, { code: "de", name: "German", native: false }]);
    const other = JSON.stringify([{ code: "es", name: "Spanish", native: true }]);
    await pool.query(
      `INSERT INTO personas (slug, display_name, wikipedia_title, wikidata_qid, origin, status, languages) VALUES
         ('max-planck', 'Max Planck', 'Max Planck', 'Q9021', 'curated', 'ready', $1::jsonb),
         ('someone', 'Someone', 'Someone', 'Q1', 'user', 'ready', $2::jsonb)`,
      [bad, other],
    );
    await applySchema(pool);
    const { rows } = await pool.query("SELECT slug, languages FROM personas ORDER BY slug");
    expect(rows).toEqual([
      { slug: "max-planck", languages: [{ code: "de", name: "German", native: true }] },
      { slug: "someone", languages: [{ code: "es", name: "Spanish", native: true }] },
    ]);
  });
});
