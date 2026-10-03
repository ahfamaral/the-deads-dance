import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { closePool, getPool } from "@corpus/db";
import { DELETE } from "@/app/api/personas/[slug]/route";
import { insertPersona, resetAuth, resetDb } from "../helpers/db";
import { signInAs } from "../helpers/auth";

let cookie = "";

const call = (slug: string) =>
  DELETE(new Request(`http://localhost/api/personas/${slug}`, { method: "DELETE", headers: { cookie } }), {
    params: Promise.resolve({ slug }),
  });

beforeEach(async () => {
  await resetDb();
  await resetAuth();
  ({ cookie } = await signInAs("boss@example.com", { role: "admin" }));
});
afterAll(() => closePool());

describe("DELETE /api/personas/[slug]", () => {
  it("answers 404 to a non-admin and deletes nothing", async () => {
    await insertPersona({ slug: "ada-lovelace", origin: "user" });
    const tester = await signInAs("t@example.com", { status: "approved" });
    const res = await DELETE(
      new Request("http://localhost/api/personas/ada-lovelace", { method: "DELETE", headers: { cookie: tester.cookie } }),
      { params: Promise.resolve({ slug: "ada-lovelace" }) },
    );
    expect(res.status).toBe(404);
    expect((await getPool().query("SELECT 1 FROM personas WHERE slug = 'ada-lovelace'")).rowCount).toBe(1);
  });

  it("deletes a user persona", async () => {
    await insertPersona({ slug: "ada-lovelace", origin: "user" });
    expect((await call("ada-lovelace")).status).toBe(204);
  });

  it("refuses a curated persona with 403", async () => {
    await insertPersona({ slug: "albert-einstein", origin: "curated" });
    const res = await call("albert-einstein");
    expect(res.status).toBe(403);
    expect((await res.json()).error).toMatch(/can't be removed/);
  });

  // Review Focus 5: a second delete finds nothing; the UI treats 404 as already removed.
  it("returns 404 once the persona is gone", async () => {
    await insertPersona({ slug: "ada-lovelace", origin: "user" });
    await call("ada-lovelace");
    expect((await call("ada-lovelace")).status).toBe(404);
  });
});
