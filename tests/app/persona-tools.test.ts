import type { DynamicStructuredTool } from "@langchain/core/tools";
import { tool } from "langchain";
import { describe, expect, it } from "vitest";
import { z } from "zod";
import { lockPersona } from "@/lib/server/persona-tools";
import { fakeMcpTool } from "../helpers/fake-mcp-tool";

const call = (name: string, args: Record<string, unknown>) => ({ type: "tool_call" as const, id: "call-1", name, args });

describe("lockPersona", () => {
  it("keeps only the allowlisted tools", () => {
    const tools = ["other_tool", "get_historical_context", "fact_check_claim", "search_biography"].map((n) => fakeMcpTool(n, () => ({})).tool);
    expect(lockPersona(tools, "wu").map((t) => t.name)).toEqual(["search_biography", "fact_check_claim", "get_historical_context"]);
  });

  // Spec §4: the model picks the year; the route injects the persona.
  it("gives get_historical_context a bounded year and no persona_id", () => {
    const [world] = lockPersona([fakeMcpTool("get_historical_context", () => ({})).tool], "wu");
    const schema = world.schema as z.ZodObject;
    expect(Object.keys(schema.shape)).toEqual(["year"]);
    expect(schema.shape.year.safeParse(1905).success).toBe(true);
    expect(schema.shape.year.safeParse(1905.5).success).toBe(false);
    expect(schema.shape.year.safeParse(0).success).toBe(false);
    expect(schema.shape.year.safeParse(2101).success).toBe(false);
  });

  it("hides persona_id from the model-facing schemas", () => {
    const [search, check] = lockPersona(
      [fakeMcpTool("search_biography", () => ({})).tool, fakeMcpTool("fact_check_claim", () => ({})).tool],
      "wu",
    );
    expect(Object.keys((search.schema as z.ZodObject).shape)).toEqual(["query", "top_k"]);
    expect(Object.keys((check.schema as z.ZodObject).shape)).toEqual(["claim"]);
  });

  // F9: the model-facing schemas should match the server's own length bound (mcp-server/server.ts).
  it("bounds query and claim length to match the server's schema", () => {
    const [search, check] = lockPersona(
      [fakeMcpTool("search_biography", () => ({})).tool, fakeMcpTool("fact_check_claim", () => ({})).tool],
      "wu",
    );
    const searchSchema = search.schema as z.ZodObject;
    const checkSchema = check.schema as z.ZodObject;
    expect(searchSchema.shape.query.safeParse("x".repeat(1001)).success).toBe(false);
    expect(searchSchema.shape.query.safeParse("x".repeat(1000)).success).toBe(true);
    expect(checkSchema.shape.claim.safeParse("x".repeat(1001)).success).toBe(false);
    expect(checkSchema.shape.claim.safeParse("x".repeat(1000)).success).toBe(true);
  });

  // Review Focus 1: the model can't reach another persona's biography.
  it("injects the persona and ignores a persona_id the model tries to pass", async () => {
    const inner = fakeMcpTool("search_biography", () => ({ status: "empty", queries: [] }));
    const [search] = lockPersona([inner.tool], "wu");
    await search.invoke(call("search_biography", { query: "parity", persona_id: "albert-einstein" }));
    expect(inner.calls).toEqual([{ query: "parity", persona_id: "wu" }]);
  });

  it("returns the structured result in an ok envelope, and its JSON to the model", async () => {
    const data = { status: "ok", passages: [], queries: ["parity"] };
    const [search] = lockPersona([fakeMcpTool("search_biography", () => data).tool], "wu");
    const msg = await search.invoke(call("search_biography", { query: "parity" }));
    expect(msg.artifact).toEqual({ ok: true, data });
    expect(msg.content).toBe(JSON.stringify(data));
  });

  it("turns a failing MCP call into an error envelope instead of throwing", async () => {
    const failing = fakeMcpTool("search_biography", () => {
      throw new Error("Not connected");
    });
    const [search] = lockPersona([failing.tool], "wu");
    const msg = await search.invoke(call("search_biography", { query: "parity" }));
    expect(msg.artifact).toEqual({ ok: false, error: expect.stringContaining("Not connected") });
    expect(msg.content).toMatch(/^Tool failed: /);
  });

  // F5: Stop must be able to cancel an in-flight MCP call, so the locked tool's abort signal
  // has to reach the inner (MCP-backed) tool, not just the wrapper.
  it("forwards the abort signal to the inner tool", async () => {
    let seenSignal: AbortSignal | undefined;
    const inner = tool(
      async (_args: Record<string, unknown>, config) => {
        seenSignal = config?.signal;
        return [JSON.stringify({}), [{ type: "mcp_structured_content", data: {} }]];
      },
      { name: "search_biography", description: "fake", schema: z.looseObject({}), responseFormat: "content_and_artifact" },
    ) as unknown as DynamicStructuredTool;
    const [search] = lockPersona([inner], "wu");

    const controller = new AbortController();
    await search.invoke(call("search_biography", { query: "parity" }), { signal: controller.signal });
    controller.abort();

    expect(seenSignal).toBe(controller.signal);
    expect(seenSignal?.aborted).toBe(true);
  });
});
