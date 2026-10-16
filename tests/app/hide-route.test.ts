import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { closePool, getPool } from "@corpus/db";
import { PATCH } from "@/app/api/personas/[slug]/route";
import { insertPersona, resetAuth, resetDb } from "../helpers/db";
import { signInAs } from "../helpers/auth";

let cookie = "";

const patch = (slug: string, body: unknown, as = cookie) =>
  PATCH(
    new Request(`http://localhost/api/personas/${slug}`, {
      method: "PATCH",
      headers: { cookie: as, "Content-Type": "application/json" },
      body: typeof body === "string" ? body : JSON.stringify(body),
    }),
    { params: Promise.resolve({ slug }) },
  );
const hidden = async (slug: string) => (await getPool().query("SELECT hidden FROM personas WHERE slug = $1", [slug])).rows[0]?.hidden;

beforeEach(async () => {
  await resetDb();
  await resetAuth();
  ({ cookie } = await signInAs("boss@example.com", { role: "admin" }));
});
afterAll(() => closePool());

// 2026-10-16: the admin hides a persona from testers' picker.
describe("PATCH /api/personas/[slug]", () => {
  it("hides and shows a built-in persona", async () => {
    await insertPersona({ slug: "albert-einstein", origin: "curated" });
    const res = await patch("albert-einstein", { hidden: true });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ hidden: true });
    expect(await hidden("albert-einstein")).toBe(true);
    await patch("albert-einstein", { hidden: false });
    expect(await hidden("albert-einstein")).toBe(false);
  });

  it("answers 404 to a non-admin and changes nothing", async () => {
    await insertPersona({ slug: "ada-lovelace", origin: "user" });
    const tester = await signInAs("t@example.com", { status: "approved" });
    expect((await patch("ada-lovelace", { hidden: true }, tester.cookie)).status).toBe(404);
    expect(await hidden("ada-lovelace")).toBe(false);
  });

  it("answers 404 for an unknown persona", async () => {
    expect((await patch("nobody", { hidden: true })).status).toBe(404);
  });

  it("answers 400 for a body without a boolean hidden", async () => {
    await insertPersona({ slug: "ada-lovelace", origin: "user" });
    for (const body of [{}, { hidden: "yes" }, "{not json"]) expect((await patch("ada-lovelace", body)).status).toBe(400);
    expect(await hidden("ada-lovelace")).toBe(false);
  });
});
