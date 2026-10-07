import type { DynamicStructuredTool } from "@langchain/core/tools";
import type { Pool } from "pg";
import { getPool } from "@corpus/db";
import type { PersonaLanguage } from "@corpus/languages";
import { chatModel } from "@corpus/models";
import { fetchPersonLanguages } from "@corpus/wikipedia";
import type { ModelCallRecord } from "@corpus/cost-ledger";
import type { AgentModel } from "./agent";
import { getMcpTools } from "./mcp-client";
import { resolveCosts, type ResolvedCall } from "./pricing";
import { visitorClassifier, type ClassifyVisitor } from "./visitor-classifier";

export type ChatDeps = {
  pool: Pool;
  model: AgentModel;
  /** The MCP biography tools, or null when the MCP server is unavailable. */
  getTools: () => Promise<DynamicStructuredTool[] | null>;
  /** Spec §18.2: reads the newest visitor message; resolves null on any failure. */
  classifyVisitor: ClassifyVisitor;
  /** Spec §18.4 backfill for personas stored without languages; throws on failure. */
  fetchLanguages: (qid: string) => Promise<PersonaLanguage[]>;
  /** Spec §26.3: prices a turn's recorded calls. */
  resolveCosts: (calls: readonly ModelCallRecord[]) => Promise<ResolvedCall[]>;
};

/** The real dependencies for a chat turn. Route tests replace this module. */
export function chatDeps(): ChatDeps {
  return {
    pool: getPool(),
    model: chatModel("agent"),
    getTools: getMcpTools,
    classifyVisitor: visitorClassifier(),
    fetchLanguages: (qid) => fetchPersonLanguages(qid),
    resolveCosts,
  };
}
