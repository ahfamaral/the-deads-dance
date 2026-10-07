import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { Pool } from "pg";
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { closePool, getPool } from "../../corpus/db";
import { createServer, type DepsFor, type ServerDeps } from "../../mcp-server/server";
import { insertChunks, insertPersona, resetDb } from "../helpers/db";
import { FakeEmbeddings, vectorFor } from "../helpers/fake-embeddings";

let client: Client | undefined;

function serverDeps(overrides: Partial<ServerDeps> = {}): ServerDeps {
  return {
    pool: getPool(),
    embeddings: new FakeEmbeddings(),
    expandQuery: async () => [],
    expandClaim: async () => [],
    judgeClaim: async () => ({ verdict: "supported", chunk_id: 1, explanation: "Passage 1 says so." }),
    recall: async () => ({ known: false, account: null, year: null, confidence: "low" }),
    sparql: async (query) => (query.includes("wdt:P585") ? [{ itemLabel: { value: "Battle of Tsushima" }, date: { value: "1905-05-28T00:00:00Z" } }] : []),
    ...overrides,
  };
}

/** A real MCP client talking to the real server, in memory: no child process. */
async function connect(deps: ServerDeps | DepsFor): Promise<Client> {
  const [serverSide, clientSide] = InMemoryTransport.createLinkedPair();
  await createServer(typeof deps === "function" ? deps : () => deps).connect(serverSide);
  client = new Client({ name: "test", version: "0.0.0" });
  await client.connect(clientSide);
  return client;
}

async function seedWu(chunks: number): Promise<void> {
  const id = await insertPersona({ slug: "wu" });
  await insertChunks(id, Array.from({ length: chunks }, (_, i) => vectorFor(`c${i}`)), "Parity experiment");
}

beforeEach(() => resetDb());
afterEach(async () => {
  await client?.close();
  client = undefined;
});
afterAll(() => closePool());

describe("MCP server", () => {
  it("offers search_biography and fact_check_claim", async () => {
    const c = await connect(serverDeps());
    expect((await c.listTools()).tools.map((t) => t.name)).toEqual(["search_biography", "fact_check_claim", "get_historical_context"]);
  });

  it("returns the world in a year as structured content", async () => {
    await insertPersona({ slug: "wu", lifespan: "1912–1997" });
    const c = await connect(serverDeps());
    const result = await c.callTool({ name: "get_historical_context", arguments: { year: 1905, persona_id: "wu" } });
    expect(result.structuredContent).toEqual({
      status: "ok",
      year: 1905,
      events: [{ label: "Battle of Tsushima", date: "1905-05-28" }],
      leaders: [],
      calls: [],
    });
  });

  it("rejects a year outside 1–2100 before asking Wikidata", async () => {
    const c = await connect(serverDeps());
    const result = await c.callTool({ name: "get_historical_context", arguments: { year: 3000, persona_id: "wu" } });
    expect(result.isError).toBe(true);
  });

  // Spec §19.3: the persona learns what known_elsewhere means from the tool description.
  it("describes the known_elsewhere verdict", async () => {
    const c = await connect(serverDeps());
    const tool = (await c.listTools()).tools.find((t) => t.name === "fact_check_claim");
    expect(tool?.description).toMatch(/known_elsewhere/);
    expect(tool?.description).toMatch(/recalled/);
  });

  it("returns passages as structured content, with the same JSON as text", async () => {
    await seedWu(5);
    const c = await connect(serverDeps());
    const result = await c.callTool({ name: "search_biography", arguments: { query: "parity", persona_id: "wu" } });
    expect(result.isError).toBeFalsy();
    const { calls, ...structured } = result.structuredContent as { status: string; passages: unknown[]; calls: unknown[] };
    expect(calls).toEqual([]); // the text is the same JSON minus the costs
    expect(structured.status).toBe("ok");
    expect(structured.passages).toHaveLength(3); // default top_k
    expect(JSON.parse((result.content as { text: string }[])[0].text)).toEqual(structured);
  });

  it("honours top_k and rejects values outside 1–10", async () => {
    await seedWu(6);
    const c = await connect(serverDeps());
    const five = await c.callTool({ name: "search_biography", arguments: { query: "q", persona_id: "wu", top_k: 5 } });
    expect((five.structuredContent as { passages: unknown[] }).passages).toHaveLength(5);
    for (const top_k of [0, 11]) {
      const bad = await c.callTool({ name: "search_biography", arguments: { query: "q", persona_id: "wu", top_k } });
      expect(bad.isError).toBe(true);
    }
  });

  it("reports an unknown persona as unavailable", async () => {
    const c = await connect(serverDeps());
    const result = await c.callTool({ name: "search_biography", arguments: { query: "q", persona_id: "nobody" } });
    expect(result.structuredContent).toMatchObject({ status: "unavailable" });
  });

  it("returns a fact-check verdict as structured content", async () => {
    await seedWu(2);
    const c = await connect(serverDeps());
    const result = await c.callTool({
      name: "fact_check_claim",
      arguments: { claim: "I ran the parity experiment", persona_id: "wu" },
    });
    expect(result.structuredContent).toMatchObject({ status: "ok", verdict: "supported", passage: { chunk_id: 1 } });
  });

  it("returns unavailable instead of throwing when the database is down", async () => {
    const deadPool = new Pool({ connectionString: "postgres://persona:persona@127.0.0.1:1/persona" });
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      const c = await connect(serverDeps({ pool: deadPool }));
      const result = await c.callTool({ name: "search_biography", arguments: { query: "q", persona_id: "wu" } });
      expect(result.isError).toBeFalsy();
      expect(result.structuredContent).toEqual({
        status: "unavailable",
        reason: expect.stringContaining("docker-compose"),
        calls: [],
      });
    } finally {
      error.mockRestore();
      await deadPool.end();
    }
  });

  it("returns the tool's model calls in structuredContent, not in the text", async () => {
    await seedWu(3);
    const call = { role: "helper", model: "openai/gpt-5-mini", inputTokens: 10, outputTokens: 2, cost: 40, generationId: "gen-1", latencyMs: 5 } as const;
    const c = await connect((ledger) =>
      serverDeps({
        expandQuery: async () => {
          ledger.record(call);
          return [];
        },
      }),
    );
    const result = await c.callTool({ name: "search_biography", arguments: { query: "parity", persona_id: "wu" } });
    expect((result.structuredContent as { calls: unknown }).calls).toEqual([call]);
    expect(JSON.stringify(result.content)).not.toContain("gen-1");
  });

  it("gives each tool call its own ledger", async () => {
    await seedWu(3);
    const c = await connect((ledger) => serverDeps({ expandQuery: async () => (ledger.record({ role: "helper", model: "m", inputTokens: 1, outputTokens: 1, cost: 1, generationId: null, latencyMs: 1 }), []) }));
    await c.callTool({ name: "search_biography", arguments: { query: "a", persona_id: "wu" } });
    const second = await c.callTool({ name: "search_biography", arguments: { query: "b", persona_id: "wu" } });
    expect((second.structuredContent as { calls: unknown[] }).calls).toHaveLength(1);
  });
});
