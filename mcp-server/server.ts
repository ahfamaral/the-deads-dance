import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { CostLedger, type ModelCallRecord } from "../corpus/cost-ledger";
import { describeDbError } from "../corpus/db";
import type { Unavailable } from "../corpus/tool-results";
import { factCheckClaim, type FactCheckDeps } from "./biography/fact-check";
import { searchBiography } from "./biography/search-biography";
import { getHistoricalContext, type WorldDeps } from "./world/historical-context";

export type ServerDeps = FactCheckDeps & WorldDeps;

type ToolOutput = { content: { type: "text"; text: string }[]; structuredContent: Record<string, unknown> };

/** Spec §26.3: deps built for one tool call, so the call's model costs land on its own ledger. */
export type DepsFor = (ledger: CostLedger) => ServerDeps;

function toOutput(result: object, calls: ModelCallRecord[]): ToolOutput {
  return {
    // The text is what an MCP client shows a model; the costs travel only in structuredContent.
    content: [{ type: "text", text: JSON.stringify(result) }],
    structuredContent: { ...(result as Record<string, unknown>), calls },
  };
}

/** Spec §9: tools return typed failures and never throw. Spec §26.3: each call has its own ledger. */
async function safely(depsFor: DepsFor, run: (deps: ServerDeps) => Promise<object>): Promise<ToolOutput> {
  const ledger = new CostLedger();
  try {
    return toOutput(await run(depsFor(ledger)), ledger.calls);
  } catch (err) {
    console.error(err); // stderr: stdout carries the MCP protocol
    const failure: Unavailable = {
      status: "unavailable",
      reason: describeDbError(err) ?? "The biography service failed. Try again.",
    };
    return toOutput(failure, ledger.calls);
  }
}

/** The persona MCP server (spec §3): biography and world tools. Talks Postgres and HTTP only; never sees a request object. */
export function createServer(depsFor: DepsFor): McpServer {
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
    (input) => safely(depsFor, (deps) => searchBiography(deps, input)),
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
    (input, extra) => safely(depsFor, (deps) => factCheckClaim(deps, input, extra.signal)),
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
    (input) => safely(depsFor, (deps) => getHistoricalContext(deps, input)),
  );

  return server;
}
