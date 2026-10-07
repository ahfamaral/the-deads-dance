import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { closePool, getPool } from "@corpus/db";
import { insertUser } from "../helpers/conversations";
import { resetAuth } from "../helpers/db";

beforeEach(() => resetAuth());
afterAll(() => closePool());

describe("cost schema (spec §26.2)", () => {
  it("gives a new user zero energy and no banner read", async () => {
    const id = await insertUser("ana@example.com");
    const { rows } = await getPool().query(`SELECT "energyBalance", "energyFull", "energyWarningRead" FROM "user" WHERE id = $1`, [id]);
    expect(rows[0]).toEqual({ energyBalance: "0", energyFull: "0", energyWarningRead: 100 });
  });

  it("refuses a warning threshold that isn't 100, 50, 20, 10 or 0", async () => {
    const id = await insertUser("ana@example.com");
    await expect(getPool().query(`UPDATE "user" SET "energyWarningRead" = 30 WHERE id = $1`, [id])).rejects.toThrow(/check/i);
  });

  it("seeds the starting energy at $1", async () => {
    const { rows } = await getPool().query(`SELECT value FROM settings WHERE key = 'default_starting_energy'`);
    expect(rows[0].value).toBe(1_000_000);
  });

  it("refuses an unknown model-call role or cost source", async () => {
    const id = await insertUser("ana@example.com");
    const insert = (role: string, source: string) =>
      getPool().query(
        `INSERT INTO model_calls (user_id, role, model, input_tokens, output_tokens, cost, cost_source) VALUES ($1, $2, 'm', 0, 0, 0, $3)`,
        [id, role, source],
      );
    await expect(insert("wizard", "reported")).rejects.toThrow(/check/i);
    await expect(insert("agent", "guessed")).rejects.toThrow(/check/i);
    await expect(insert("agent", "reported")).resolves.toBeDefined();
  });

  it("removes a user's calls and grants with the user", async () => {
    const id = await insertUser("ana@example.com");
    await getPool().query(`INSERT INTO model_calls (user_id, role, model, input_tokens, output_tokens, cost, cost_source) VALUES ($1, 'agent', 'm', 1, 1, 5, 'reported')`, [id]);
    await getPool().query(`INSERT INTO energy_grants (user_id, amount) VALUES ($1, 1000000)`, [id]);
    await getPool().query(`DELETE FROM "user" WHERE id = $1`, [id]);
    const { rows } = await getPool().query(`SELECT (SELECT count(*) FROM model_calls)::int AS calls, (SELECT count(*) FROM energy_grants)::int AS grants`);
    expect(rows[0]).toEqual({ calls: 0, grants: 0 });
  });

  it("refuses a grant of zero or less", async () => {
    const id = await insertUser("ana@example.com");
    await expect(getPool().query(`INSERT INTO energy_grants (user_id, amount) VALUES ($1, 0)`, [id])).rejects.toThrow(/check/i);
  });
});
