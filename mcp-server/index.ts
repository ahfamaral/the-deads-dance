import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { liveDepsFor } from "./deps";
import { createServer } from "./server";

// The stdio entry point, for MCP Inspector (`npm run mcp`). The app runs the same server
// in-process (src/lib/server/mcp-client.ts, spec §31.4).
// stdout carries the MCP protocol: log with console.error only. No top-level await —
// tsx runs this file as CommonJS (package.json has no "type": "module").
async function main() {
  await createServer(liveDepsFor()).connect(new StdioServerTransport());
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
