import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { CostLedger } from "@corpus/cost-ledger";
import { closePool, getPool } from "@corpus/db";
import type { AddPersonaEvent } from "@/lib/add-persona-events";
import { readNdjson } from "@/lib/ndjson";
import { FakeEmbeddings } from "../helpers/fake-embeddings";
import { insertPersona, resetAuth, resetDb } from "../helpers/db";
import { giveEnergy } from "../helpers/energy";
import { signInAs } from "../helpers/auth";
import { article } from "../fixtures/articles";

const deps = vi.hoisted(() => ({ current: null as unknown }));
vi.mock("@/lib/server/corpus-deps", () => ({
  corpusDeps: (ledger?: CostLedger) => {
    if (deps.current instanceof Error) throw deps.current;
    const fakes = deps.current as { generateProfile: (text: string) => Promise<unknown> };
    return {
      ...fakes,
      generateProfile: async (text: string) => {
        ledger?.record({ role: "ingest", model: "m", inputTokens: 10, outputTokens: 5, cost: 400, generationId: null, latencyMs: 1 });
        return fakes.generateProfile(text);
      },
    };
  },
}));

const { POST } = await import("@/app/api/personas/route");

let cookie = "";
let adminId = "";

const post = (body: unknown) =>
  POST(
    new Request("http://localhost/api/personas", {
      method: "POST",
      headers: { "Content-Type": "application/json", cookie },
      body: JSON.stringify(body),
    }),
  );

async function events(res: Response): Promise<AddPersonaEvent[]> {
  const out: AddPersonaEvent[] = [];
  for await (const e of readNdjson<AddPersonaEvent>(res.body!)) out.push(e);
  return out;
}

beforeEach(async () => {
  await resetDb();
  deps.current = {
    pool: getPool(),
    embeddings: new FakeEmbeddings(),
    fetchArticle: vi.fn(async () => article()),
    fetchPersonFacts: vi.fn(async () => ({ isHuman: true, isDeceased: true, description: "Physicist", lifespan: "1912–1997" })),
    fetchLanguages: vi.fn(async () => []),
    generateProfile: vi.fn(async () => ({
      temperament: "Exacting",
      humour: "unknown",
      passions: "Beta decay",
      indifferences: "unknown",
      speech: "Precise",
      sore_points: "unknown",
    })),
  };
  await resetAuth();
  ({ cookie, userId: adminId } = await signInAs("boss@example.com", { role: "admin" }));
});
afterAll(() => closePool());

describe("POST /api/personas", () => {
  it("streams progress, then the new persona", async () => {
    const res = await post({ wikipediaTitle: "Chien-Shiung Wu" });
    expect(res.status).toBe(200);
    expect(res.headers.get("Content-Type")).toBe("application/x-ndjson");

    const all = await events(res);
    const progress = all.flatMap((e) => (e.type === "progress" ? [`${e.step}:${e.status}`] : []));
    expect(progress.slice(0, 4)).toEqual(["chunking:started", "chunking:finished", "embedding:started", "profiling:started"]);
    expect(progress.slice(4, 6).sort()).toEqual(["embedding:finished", "profiling:finished"]);
    expect(progress.slice(6)).toEqual(["saving:started", "saving:finished"]);
    expect(all.at(-2)).toEqual({ type: "cost", report: expect.objectContaining({ total: { tokens: 15, cost: 400 } }) });
    expect(all.at(-1)).toEqual({
      type: "done",
      persona: { id: "chien-shiung-wu", name: "Chien-Shiung Wu", description: "Physicist", lifespan: "1912–1997", origin: "user", hidden: false },
    });
  });

  it("logs the ingest's calls against the admin without charging", async () => {
    await giveEnergy(adminId, 500_000);
    await events(await post({ wikipediaTitle: "Chien-Shiung Wu" }));
    const { rows } = await getPool().query(`SELECT role, persona_slug, user_id, cost FROM model_calls`);
    expect(rows).toEqual([expect.objectContaining({ role: "ingest", persona_slug: "chien-shiung-wu", user_id: adminId })]);
    expect(Number(rows[0].cost)).toBe(400);
    const { rows: u } = await getPool().query(`SELECT "energyBalance" FROM "user" WHERE id = $1`, [adminId]);
    expect(Number(u[0].energyBalance)).toBe(500_000);
  });

  it("answers 404 to a non-admin, before ingesting anything", async () => {
    const tester = await signInAs("t@example.com", { status: "approved" });
    const res = await POST(
      new Request("http://localhost/api/personas", {
        method: "POST",
        headers: { "Content-Type": "application/json", cookie: tester.cookie },
        body: JSON.stringify({ wikipediaTitle: "Chien-Shiung Wu" }),
      }),
    );
    expect(res.status).toBe(404);
    expect((deps.current as { fetchArticle: ReturnType<typeof vi.fn> }).fetchArticle).not.toHaveBeenCalled();
  });

  it("rejects a missing title with 400 before streaming", async () => {
    const res = await post({});
    expect(res.status).toBe(400);
    expect((await res.json()).code).toBe("invalid_title");
  });

  it("rejects malformed JSON with 400", async () => {
    const res = await POST(
      new Request("http://localhost/api/personas", {
        method: "POST",
        headers: { "Content-Type": "application/json", cookie },
        body: "{",
      }),
    );
    expect(res.status).toBe(400);
  });

  it("rejects a request without a JSON content-type with 415", async () => {
    const res = await POST(
      new Request("http://localhost/api/personas", {
        method: "POST",
        headers: { cookie },
        body: JSON.stringify({ wikipediaTitle: "Chien-Shiung Wu" }),
      }),
    );
    expect(res.status).toBe(415);
    expect((await res.json()).code).toBe("invalid_title");
  });

  it("returns 409 with the existing persona", async () => {
    await insertPersona({ slug: "chien-shiung-wu", displayName: "Chien-Shiung Wu", origin: "curated" });
    const res = await post({ wikipediaTitle: "Chien-Shiung Wu" });
    expect(res.status).toBe(409);
    expect((await res.json()).persona).toMatchObject({ id: "chien-shiung-wu", origin: "curated" });
  });

  it("returns 422 for a non-person", async () => {
    (deps.current as { fetchPersonFacts: unknown }).fetchPersonFacts = vi.fn(async () => ({
      isHuman: false,
      isDeceased: false,
      description: "",
      lifespan: "",
    }));
    expect((await post({ wikipediaTitle: "Photosynthesis" })).status).toBe(422);
  });

  it("returns 422 for a living person", async () => {
    (deps.current as { fetchPersonFacts: unknown }).fetchPersonFacts = vi.fn(async () => ({
      isHuman: true,
      isDeceased: false,
      description: "Physicist",
      lifespan: "born 1950",
    }));
    const res = await post({ wikipediaTitle: "Someone Alive" });
    expect(res.status).toBe(422);
    expect((await res.json()).code).toBe("not_deceased");
  });

  it("streams an error event when embedding fails", async () => {
    (deps.current as { embeddings: unknown }).embeddings = new FakeEmbeddings({ fail: new Error("429") });
    const quiet = vi.spyOn(console, "error").mockImplementation(() => {});
    const all = await events(await post({ wikipediaTitle: "Chien-Shiung Wu" }));
    quiet.mockRestore();
    expect(all.at(-1)).toEqual({ type: "error", message: "Adding the persona failed. Try again in a moment." });
    expect(all.at(-2)?.type).toBe("cost");
  });

  it("returns 503 when the dependencies can't be built", async () => {
    deps.current = new Error("OPENROUTER_API_KEY is not set. Add it to .env.");
    const quiet = vi.spyOn(console, "error").mockImplementation(() => {});
    const res = await post({ wikipediaTitle: "Chien-Shiung Wu" });
    quiet.mockRestore();

    expect(res.status).toBe(503);
    expect(await res.json()).toEqual({
      error: "OPENROUTER_API_KEY is not set. Add it to .env.",
      code: "unavailable",
    });
  });
});
