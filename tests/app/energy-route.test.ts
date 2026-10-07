import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { closePool, getPool } from "@corpus/db";
import { POST } from "@/app/api/energy/read/route";
import { signInAs, withCookie } from "../helpers/auth";
import { resetAuth } from "../helpers/db";

const read = (cookie: string, body: unknown) =>
  POST(new Request("http://localhost/api/energy/read", withCookie(cookie, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) })));
const warningRead = async (id: string) => (await getPool().query(`SELECT "energyWarningRead" AS w FROM "user" WHERE id = $1`, [id])).rows[0].w;

beforeEach(() => resetAuth());
afterAll(() => closePool());

describe("POST /api/energy/read (spec §26.5)", () => {
  it("remembers the closed banner, and only ever lowers it", async () => {
    const { cookie, userId } = await signInAs("ana@example.com", { status: "approved" });
    expect((await read(cookie, { threshold: 20 })).status).toBe(204);
    expect(await warningRead(userId)).toBe(20);
    await read(cookie, { threshold: 50 });
    expect(await warningRead(userId)).toBe(20);
  });

  it("refuses a threshold that isn't 50, 20, 10 or 0", async () => {
    const { cookie } = await signInAs("ana@example.com", { status: "approved" });
    expect((await read(cookie, { threshold: 30 })).status).toBe(400);
    expect((await read(cookie, { threshold: 100 })).status).toBe(400);
  });

  it("refuses a signed-out caller", async () => {
    expect((await read("", { threshold: 20 })).status).toBe(401);
  });
});
