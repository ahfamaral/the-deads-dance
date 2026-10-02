import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { describeDbError } from "../corpus/db";
import type { Unavailable } from "../corpus/tool-results";
import { factCheckClaim, type FactCheckDeps } from "./biography/fact-check";
import { searchBiography } from "./biography/search-biography";
import { getHistoricalContext, type WorldDeps } from "./world/historical-context";

export type ServerDeps = FactCheckDeps & WorldDeps;

type ToolOutput = { content: { type: "text"; text: string }[]; structuredContent: Record<string, unknown> };

function toOutput(result: object): ToolOutput {
  return {
    content: [{ type: "text", text: JSON.stringify(result) }],
    structuredContent: result as Record<string, unknown>,
  };
}

/** Spec §9: tools return typed failures and never throw — an exception would kill the agent's turn. */
async function safely(run: () => Promise<object>): Promise<ToolOutput> {
  try {
    return toOutput(await run());
  } catch (err) {
    console.error(err); // stderr: stdout carries the MCP protocol
    const failure: Unavailable = {
      status: "unavailable",
      reason: describeDbError(err) ?? "The biography service failed. Try again.",
    };
    return toOutput(failure);
  }
}

/** The persona MCP server (spec §3): biography and world tools. Talks Postgres and HTTP only; never sees a request object. */
export function createServer(deps: ServerDeps): McpServer {
  const server = new McpServer({ name: "persona-biography", version: "0.1.0" });

  server.registerTool(
    "search_biography",
    {
      description:
        "Search the persona's biography for passages relevant to a question. Returns passages with their section headings. Use it before stating any fact about the persona's life.",
      inputSchema: {
        query: z.string().min(1).max(1000).describe("What to look up, in plain words"),
        persona_id: z.string().min(1).max(200),
        top_k: z.number().int().min(1).max(10).optional().describe("How many passages to return; default 3"),
      },
    },
    (input) => safely(() => searchBiography(deps, input)),
  );

  server.registerTool(
    "fact_check_claim",
    {
      description:
        "Check a claim the user made about the persona's life against the biography. Returns supported, contradicted or not_mentioned, with the passage it judged from, or known_elsewhere when the biography doesn't cover the claim but it is widely recorded elsewhere, with what happened in recalled. Use it before agreeing with a user's claim about the persona's life.",
      inputSchema: {
        claim: z.string().min(1).max(1000).describe("The claim, restated as one sentence"),
        persona_id: z.string().min(1).max(200),
      },
    },
    // extra.signal aborts when the client cancels the call (Stop or a closed tab aborts the agent).
    (input, extra) => safely(() => factCheckClaim(deps, input, extra.signal)),
  );

  server.registerTool(
    "get_historical_context",
    {
      description:
        "What was happening in the world in one year of the persona's life: notable events dated that year, and who held the top offices in the persona's countries. From Wikidata. Returns empty for a year after the persona's death. Use it when the visitor asks what the world was like in a year, or to place a memory in its time.",
      inputSchema: {
        year: z.number().int().min(1).max(2100).describe("The year, e.g. 1905"),
        persona_id: z.string().min(1).max(200),
      },
    },
    (input) => safely(() => getHistoricalContext(deps, input)),
  );

  return server;
}
