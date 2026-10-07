import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { closePool, getPool } from "@corpus/db";
import { heldEnergy, loggedSpend, recordCalls, spendToday } from "@/lib/server/spend";
import { insertUser } from "../helpers/conversations";
import { resetAuth } from "../helpers/db";
import { giveEnergy } from "../helpers/energy";

const call = (cost: number) => ({ role: "classifier" as const, model: "m", inputTokens: 10, outputTokens: 5, cost, costSource: "reported" as const, generationId: null, latencyMs: 1 });

beforeEach(() => resetAuth());
afterAll(() => closePool());

describe("spend", () => {
  it("records calls without a conversation, and charges only when asked", async () => {
    const ana = await insertUser("ana@example.com");
    await giveEnergy(ana, 1_000_000);
    await recordCalls(getPool(), { userId: ana, calls: [call(500)], charge: true });
    await recordCalls(getPool(), { userId: ana, calls: [call(700)], charge: false, personaSlug: "wu" });
    const { rows } = await getPool().query(`SELECT "energyBalance" FROM "user" WHERE id = $1`, [ana]);
    expect(Number(rows[0].energyBalance)).toBe(999_500);
    expect(await spendToday(getPool(), ana)).toEqual({ tokens: 30, cost: 1_200 });
  });

  it("splits logged spend by UTC day, week and month", async () => {
    const ana = await insertUser("ana@example.com");
    await recordCalls(getPool(), { userId: ana, calls: [call(100)], charge: false });
    await getPool().query(`INSERT INTO model_calls (user_id, role, model, cost, cost_source, created_at) VALUES ($1, 'agent', 'm', 900, 'reported', now() - interval '40 days')`, [ana]);
    const spend = await loggedSpend(getPool());
    expect(spend.today.cost).toBe(100);
    expect(spend.month.cost).toBe(100);
  });

  it("adds up the energy testers still hold, ignoring overdrafts, admins and the unapproved", async () => {
    const ana = await insertUser("ana@example.com");
    const rui = await insertUser("rui@example.com");
    const boss = await insertUser("boss@example.com");
    await getPool().query(`UPDATE "user" SET role = 'admin' WHERE id = $1`, [boss]);
    await giveEnergy(ana, 700_000);
    await giveEnergy(rui, -20_000, 1_000_000);
    await giveEnergy(boss, 5_000_000);
    expect(await heldEnergy(getPool())).toBe(700_000);
  });
});
