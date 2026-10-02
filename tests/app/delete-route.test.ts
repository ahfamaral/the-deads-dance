import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { closePool } from "@corpus/db";
import { DELETE } from "@/app/api/personas/[slug]/route";
import { insertPersona, resetDb } from "../helpers/db";

const call = (slug: string) =>
  DELETE(new Request(`http://localhost/api/personas/${slug}`, { method: "DELETE" }), {
    params: Promise.resolve({ slug }),
  });

beforeEach(() => resetDb());
afterAll(() => closePool());

describe("DELETE /api/personas/[slug]", () => {
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
