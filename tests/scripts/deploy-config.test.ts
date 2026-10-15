import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const read = (file: string) => JSON.parse(readFileSync(file, "utf8"));

// Spec §31.4: the schema step runs before next build on Vercel, and only `staging` deploys.
describe("deploy config", () => {
  it("runs the schema step before next build", () => {
    const { scripts } = read("package.json");
    expect(scripts["vercel-build"]).toBe("npm run db:setup:deploy && next build");
    expect(scripts["db:setup:deploy"]).toBe("tsx scripts/db-setup-deploy.ts");
    expect(scripts.build).toBe("next build");
  });

  it("pins the build command, the region and the deploy branch", () => {
    const config = read("vercel.json");
    expect(config.buildCommand).toBe("npm run vercel-build");
    expect(config.regions).toEqual(["iad1"]);
    expect(config.git.deploymentEnabled).toEqual({ "**": false, staging: true });
  });
});
