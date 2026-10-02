import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { getPool } from "../corpus/db";
import { embeddingModel } from "../corpus/embeddings";
import { chatModel } from "../corpus/models";
import { judgeClaimWith } from "./biography/fact-check";
import { recallWith } from "./biography/recall";
import { cachedSparql, sparqlWith } from "./world/historical-context";
import { CLAIM_EXPANSION_PROMPT, expandQueryWith } from "./biography/retrieval";
import { createServer } from "./server";

// stdout carries the MCP protocol: log with console.error only. No top-level await —
// tsx runs this file as CommonJS (package.json has no "type": "module").
async function main() {
  const helper = chatModel("helper");
  // Spec §20.1: rewording a question needs no reasoning. Splitting a claim into its details
  // needs a little (minimal failed the NBS parity check), and the verdict keeps the default effort.
  const expander = chatModel("helper", { reasoningEffort: "minimal" });
  const claimSplitter = chatModel("helper", { reasoningEffort: "low" });
  const server = createServer({
    pool: getPool(),
    embeddings: embeddingModel(),
    expandQuery: expandQueryWith(expander),
    expandClaim: expandQueryWith(claimSplitter, CLAIM_EXPANSION_PROMPT),
    judgeClaim: judgeClaimWith(helper),
    // Spec §19.2: its own model and a short budget, so three sequential calls fit the 30 s tool timeout.
    recall: recallWith(chatModel("recall")),
    sparql: cachedSparql(sparqlWith()),
  });
  await server.connect(new StdioServerTransport());
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
