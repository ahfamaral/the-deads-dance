import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Loaded as plain Node requires (traced into the deployment), not bundled. The MCP server runs in-process (spec §31.4).
  serverExternalPackages: ["@langchain/mcp-adapters", "@modelcontextprotocol/sdk"],
};

export default nextConfig;
