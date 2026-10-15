import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { closePool, getPool } from "@corpus/db";
import { closeMcpClient, connectInMemory, getMcpTools, TOOL_TIMEOUT_MS, type McpConnection } from "@/lib/server/mcp-client";
import type { ServerDeps } from "../../mcp-server/server";
import { insertPersona, resetDb } from "../helpers/db";
import { FakeEmbeddings } from "../helpers/fake-embeddings";

const TOOL_NAMES = ["search_biography", "fact_check_claim", "get_historical_context"];

function fakeDeps(overrides: Partial<ServerDeps> = {}): ServerDeps {
  return {
    pool: getPool(),
    embeddings: new FakeEmbeddings(),
    expandQuery: async () => [],
    expandClaim: async () => [],
    judgeClaim: async () => ({ verdict: "supported", chunk_id: 1, explanation: "Passage 1 says so." }),
    recall: async () => ({ known: false, account: null, year: null, confidence: "low" }),
    recallTopic: async () => ({ known: false, account: null, year: null, confidence: "low" }),
    sparql: async (query) => (query.includes("wdt:P585") ? [{ itemLabel: { value: "Battle of Tsushima" }, date: { value: "1905-05-28T00:00:00Z" } }] : []),
    ...overrides,
  };
}

const toolCall = (name: string, args: Record<string, unknown>) => ({ type: "tool_call" as const, id: "call-1", name, args });

let connection: McpConnection | undefined;

beforeEach(() => resetDb());
afterEach(async () => {
  await connection?.close();
  connection = undefined;
  await closeMcpClient();
  vi.unstubAllEnvs();
});
afterAll(() => closePool());

describe("connectInMemory", () => {
  it("loads the three tools with today's names and the 30 s timeout", async () => {
    connection = await connectInMemory(() => fakeDeps());
    expect(connection.tools.map((t) => t.name)).toEqual(TOOL_NAMES);
    for (const t of connection.tools) expect(t.defaultConfig?.timeout).toBe(TOOL_TIMEOUT_MS);
  });

  it("calls a tool through the protocol and keeps the structured content artifact", async () => {
    await insertPersona({ slug: "wu", lifespan: "1912–1997" });
    connection = await connectInMemory(() => fakeDeps());
    const world = connection.tools.find((t) => t.name === "get_historical_context")!;
    const msg = await world.invoke(toolCall(world.name, { year: 1905, persona_id: "wu" }));
    const artifacts = (msg.artifact ?? []) as { type: string; data?: unknown }[];
    const structured = artifacts.find((a) => a.type === "mcp_structured_content");
    expect(structured?.data).toMatchObject({
      status: "ok",
      year: 1905,
      events: [{ label: "Battle of Tsushima", date: "1905-05-28" }],
      calls: [],
    });
  });

  // Review Focus 2: Stop aborts the agent; a hanging lookup must not hold the turn.
  it("rejects promptly when the call's signal aborts", async () => {
    await insertPersona({ slug: "wu", lifespan: "1912–1997" });
    connection = await connectInMemory(() => fakeDeps({ sparql: () => new Promise(() => {}) }));
    const world = connection.tools.find((t) => t.name === "get_historical_context")!;
    const controller = new AbortController();
    const pending = world.invoke(toolCall(world.name, { year: 1905, persona_id: "wu" }), { signal: controller.signal });
    setTimeout(() => controller.abort(), 50);
    await expect(pending).rejects.toThrow();
  });
});

describe("getMcpTools", () => {
  it("returns the tools from the live deps (no network until a tool is called)", async () => {
    vi.stubEnv("OPENROUTER_API_KEY", "test-key");
    const tools = await getMcpTools();
    expect(tools?.map((t) => t.name)).toEqual(TOOL_NAMES);
  });

  // Review Focus 1: a cold instance with two requests at once builds one server.
  it("shares one connection between concurrent first calls", async () => {
    vi.stubEnv("OPENROUTER_API_KEY", "test-key");
    const [a, b] = await Promise.all([getMcpTools(), getMcpTools()]);
    expect(a).not.toBeNull();
    expect(a).toBe(b);
    expect(await getMcpTools()).toBe(a);
  });

  // Review Focus 3: a failed start gives null (banner), and the next request starts afresh.
  it("returns null when the server can't be built, then recovers", async () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    vi.stubEnv("OPENROUTER_API_KEY", "");
    expect(await getMcpTools()).toBeNull();
    expect(error).toHaveBeenCalled();
    vi.stubEnv("OPENROUTER_API_KEY", "test-key");
    expect((await getMcpTools())?.map((t) => t.name)).toEqual(TOOL_NAMES);
    error.mockRestore();
  });

  it("starts a new connection after closeMcpClient", async () => {
    vi.stubEnv("OPENROUTER_API_KEY", "test-key");
    const first = await getMcpTools();
    await closeMcpClient();
    const second = await getMcpTools();
    expect(second).not.toBeNull();
    expect(second).not.toBe(first);
  });
});
