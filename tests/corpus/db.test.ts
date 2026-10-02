import { describe, expect, it } from "vitest";
import { describeDbError, toVectorLiteral } from "../../corpus/db";

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
