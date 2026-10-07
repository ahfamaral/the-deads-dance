import { describe, expect, it } from "vitest";
import { formatDollars, formatTokens, MAX_GRANT, MIN_GRANT, parseGrant, spendLabel } from "@/lib/money";

describe("parseGrant", () => {
  it.each([
    ["1", 1_000_000],
    ["1.5", 1_500_000],
    ["0.01", MIN_GRANT],
    ["5", MAX_GRANT],
    ["5.00", MAX_GRANT],
    [" 2.25 ", 2_250_000],
    [1, 1_000_000],
  ])("accepts %j", (input, micros) => {
    expect(parseGrant(input)).toBe(micros);
  });

  it.each(["0.001", "5.01", "abc", "-1", "", "0", "0.00", "1e2", "1,5", null, undefined, {}])("refuses %j", (input) => {
    expect(parseGrant(input)).toBeNull();
  });
});

describe("formatDollars", () => {
  it.each([
    [1_000_000, "$1.00"],
    [1_140_000, "$1.14"],
    [31_000, "$0.031"],
    [9_000, "$0.009"],
    [900, "$0.0009"],
    [0, "$0.00"],
    [-20_000, "−$0.02"],
  ])("%i → %s", (micros, text) => {
    expect(formatDollars(micros)).toBe(text);
  });
});

describe("formatTokens and spendLabel", () => {
  it("shortens thousands", () => {
    expect(formatTokens(950)).toBe("950 tok");
    expect(formatTokens(4_200)).toBe("4.2k tok");
    expect(formatTokens(18_000)).toBe("18k tok");
  });
  it("joins tokens and dollars", () => {
    expect(spendLabel({ tokens: 1_800, cost: 9_000 })).toBe("1.8k tok · $0.009");
  });
});
