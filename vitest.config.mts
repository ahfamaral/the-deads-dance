import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

const TEST_DATABASE_URL =
  process.env.TEST_DATABASE_URL ?? "postgres://persona:persona@localhost:5432/persona_test";
const live = Boolean(process.env.LIVE);

export default defineConfig({
  resolve: {
    alias: {
      "@corpus": fileURLToPath(new URL("./corpus", import.meta.url)),
      "@": fileURLToPath(new URL("./src", import.meta.url)),
    },
  },
  test: {
    environment: "node",
    include: ["tests/**/*.test.ts"],
    exclude: live ? [] : ["tests/live/**"],
    globalSetup: live ? [] : ["tests/setup/global-setup.ts"],
    // Test files share one database, so they must not run concurrently.
    fileParallelism: false,
    env: { DATABASE_URL: TEST_DATABASE_URL },
    testTimeout: 20_000,
  },
});
