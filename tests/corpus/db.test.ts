import { describe, expect, it, vi } from "vitest";
import { closePool, deployDatabaseUrl, describeDbError, getPool, poolMax, toVectorLiteral } from "../../corpus/db";

describe("toVectorLiteral", () => {
  it("formats a vector as pgvector text", () => {
    expect(toVectorLiteral([0.5, -1, 2])).toBe("[0.5,-1,2]");
  });
});

describe("describeDbError", () => {
  it("explains a refused connection, including Node's AggregateError form", () => {
    const refused = Object.assign(new Error("connect"), { code: "ECONNREFUSED" });
    expect(describeDbError(refused)).toMatch(/docker-compose up/);
    expect(describeDbError(new AggregateError([refused]))).toMatch(/docker-compose up/);
  });

  it("points a missing table at db:setup", () => {
    expect(describeDbError(Object.assign(new Error("x"), { code: "42P01" }))).toMatch(/db:setup/);
  });

  it("returns null for anything else", () => {
    expect(describeDbError(new Error("boom"))).toBeNull();
  });
});

describe("deployDatabaseUrl", () => {
  it("prefers the direct (unpooled) URL", () => {
    expect(deployDatabaseUrl({ DATABASE_URL_UNPOOLED: "postgres://direct", DATABASE_URL: "postgres://pooled" })).toBe("postgres://direct");
  });

  it("falls back to DATABASE_URL", () => {
    expect(deployDatabaseUrl({ DATABASE_URL: "postgres://pooled" })).toBe("postgres://pooled");
    expect(deployDatabaseUrl({ DATABASE_URL_UNPOOLED: "", DATABASE_URL: "postgres://pooled" })).toBe("postgres://pooled");
  });

  it("fails clearly when neither is set", () => {
    expect(() => deployDatabaseUrl({})).toThrow("Neither DATABASE_URL_UNPOOLED nor DATABASE_URL is set.");
  });
});

// Review Focus 5: only a positive integer overrides pg's default.
describe("poolMax", () => {
  it("reads a positive integer", () => {
    expect(poolMax({ DATABASE_POOL_MAX: "5" })).toBe(5);
    expect(poolMax({ DATABASE_POOL_MAX: " 5 " })).toBe(5);
  });

  it("keeps pg's default for anything else", () => {
    for (const value of [undefined, "", "0", "-3", "5.5", "abc", "1e3"]) {
      expect(poolMax({ DATABASE_POOL_MAX: value })).toBeUndefined();
    }
  });
});

// Neon drops idle connections (compute suspends); pg then emits 'error' on the pool. With no
// listener Node treats it as an uncaught exception and the serverless instance dies.
describe("getPool", () => {
  it("logs an idle client's error instead of crashing the process", async () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    const pool = getPool();
    expect(() => pool.emit("error", new Error("Connection terminated unexpectedly"))).not.toThrow();
    expect(error).toHaveBeenCalled();
    error.mockRestore();
    await closePool();
  });
});
