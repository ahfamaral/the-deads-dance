import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { closePool, getPool } from "@corpus/db";
import { POST as ADD } from "@/app/api/admin/users/[id]/energy/route";
import { GET as READ_SETTINGS, PUT as WRITE_SETTINGS } from "@/app/api/admin/settings/route";
import { signInAs, withCookie } from "../helpers/auth";
import { insertUser } from "../helpers/conversations";
import { resetAuth } from "../helpers/db";
import { giveEnergy } from "../helpers/energy";

let admin = "";
beforeEach(async () => {
  await resetAuth();
  await getPool().query(`UPDATE settings SET value = '1000000' WHERE key = 'default_starting_energy'`);
  ({ cookie: admin } = await signInAs("boss@example.com", { role: "admin" }));
});
afterAll(() => closePool());

const json = (cookie: string, method: string, body: unknown) =>
  withCookie(cookie, { method, headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
const add = (cookie: string, id: string, amount: unknown) =>
  ADD(new Request(`http://localhost/api/admin/users/${id}/energy`, json(cookie, "POST", { amount })), { params: Promise.resolve({ id }) } as never);

describe("Add energy (spec §26.6)", () => {
  it("absorbs an overdraft, refills the bar and clears the banners (Review Focus 2)", async () => {
    const ana = await insertUser("ana@example.com");
    await giveEnergy(ana, -20_000, 1_000_000);
    await getPool().query(`UPDATE "user" SET "energyWarningRead" = 0 WHERE id = $1`, [ana]);
    const res = await add(admin, ana, "1");
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ ok: true, email: "ana@example.com", balance: 980_000, full: 980_000 });
    const { rows } = await getPool().query(`SELECT "energyWarningRead" AS w, (SELECT count(*)::int FROM energy_grants WHERE user_id = $1) AS grants FROM "user" WHERE id = $1`, [ana]);
    expect(rows[0]).toEqual({ w: 100, grants: 1 });
  });

  it.each(["0.001", "5.01", "abc", "-1", "", "0"])("refuses the amount %j (Review Focus 5)", async (amount) => {
    const ana = await insertUser("ana@example.com");
    expect((await add(admin, ana, amount)).status).toBe(400);
  });

  it("refuses an admin's row, an unknown user, and a non-admin caller", async () => {
    const { userId: bossId } = await signInAs("boss@example.com", { role: "admin" });
    expect((await add(admin, bossId, "1")).status).toBe(409);
    expect((await add(admin, "nobody", "1")).status).toBe(404);
    const { cookie: tester } = await signInAs("ana@example.com", { status: "approved" });
    const ana = (await getPool().query(`SELECT id FROM "user" WHERE email = 'ana@example.com'`)).rows[0].id;
    expect((await add(tester, ana, "1")).status).toBe(404);
  });
});

describe("starting energy setting", () => {
  it("reads and writes the default within $0.01–$5.00", async () => {
    expect(await (await READ_SETTINGS(new Request("http://localhost/api/admin/settings", withCookie(admin)))).json()).toEqual({ startingEnergy: 1_000_000 });
    expect((await WRITE_SETTINGS(new Request("http://localhost/api/admin/settings", json(admin, "PUT", { startingEnergy: "0.5" })))).status).toBe(200);
    expect(await (await READ_SETTINGS(new Request("http://localhost/api/admin/settings", withCookie(admin)))).json()).toEqual({ startingEnergy: 500_000 });
    expect((await WRITE_SETTINGS(new Request("http://localhost/api/admin/settings", json(admin, "PUT", { startingEnergy: "6" })))).status).toBe(400);
  });
});
