import { describe, expect, it } from "vitest";
import { birthYear, deathYear, deathYearNumber } from "../../corpus/lifespan";

describe("deathYear", () => {
  it("reads the end year of a lifespan", () => {
    expect(deathYear("1912–1997")).toBe("1997");
    expect(deathYear("c. 1864–1943")).toBe("1943");
    expect(deathYear("1873-1932")).toBe("1932");
    expect(deathYear("died 1932")).toBe("1932");
    expect(deathYear("470 BC–399 BC")).toBe("399 BC");
    expect(deathYear("died 44 BC")).toBe("44 BC");
  });

  it("returns null when there is no end year", () => {
    expect(deathYear("born 1950")).toBeNull();
    expect(deathYear("")).toBeNull();
  });
});

// Spec §19.2: recall compares years as numbers, so BC years are negative.
describe("deathYearNumber", () => {
  it("turns the end year into a number", () => {
    expect(deathYearNumber("1945–1981")).toBe(1981);
    expect(deathYearNumber("c. 1864–1943")).toBe(1943);
  });

  it("makes BC years negative", () => {
    expect(deathYearNumber("470 BC–399 BC")).toBe(-399);
    expect(deathYearNumber("died 44 BC")).toBe(-44);
  });

  it("returns null when there is no end year", () => {
    expect(deathYearNumber("born 1950")).toBeNull();
    expect(deathYearNumber("")).toBeNull();
  });
});

// Spec §28.3: the "Your time" line names the birth year; "c." makes it approximate.
describe("birthYear", () => {
  it("reads the start year of a lifespan", () => {
    expect(birthYear("1912–1997")).toEqual({ year: "1912", approximate: false });
    expect(birthYear("1873-1932")).toEqual({ year: "1873", approximate: false });
    expect(birthYear("470 BC–399 BC")).toEqual({ year: "470 BC", approximate: false });
    expect(birthYear("born 1950")).toEqual({ year: "1950", approximate: false });
  });

  it("marks a circa year as approximate", () => {
    expect(birthYear("c. 1864–1943")).toEqual({ year: "1864", approximate: true });
  });

  it("returns null when there is no start year", () => {
    expect(birthYear("died 1932")).toBeNull();
    expect(birthYear("died 44 BC")).toBeNull();
    expect(birthYear("")).toBeNull();
  });
});
