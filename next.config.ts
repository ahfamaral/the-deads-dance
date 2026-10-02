import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // The chat route spawns the MCP server as a child process; keep these as plain Node requires.
  serverExternalPackages: ["@langchain/mcp-adapters", "@modelcontextprotocol/sdk"],
};

export default nextConfig;
