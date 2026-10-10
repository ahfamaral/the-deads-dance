import { describe, expect, it } from "vitest";
import { codeWarning, describeCode, parseCodeVersion } from "../../eval/code-version";

describe("parseCodeVersion", () => {
  it("keeps the short commit and lists changed, new and renamed files", () => {
    const status = " M eval/prompts/f.ts\n?? eval/prompts/v6.ts\nR  src/a.ts -> src/b.ts\n";
    expect(parseCodeVersion("13fa689c0ffee\n", status)).toEqual({ commit: "13fa689", uncommitted: ["eval/prompts/f.ts", "eval/prompts/v6.ts", "src/b.ts"] });
  });
  it("has nothing uncommitted on a clean tree", () => {
    expect(parseCodeVersion("13fa689", "")).toEqual({ commit: "13fa689", uncommitted: [] });
  });
});

describe("codeWarning", () => {
  it("warns before a run on uncommitted code, since the commit alone won't reproduce it", () => {
    expect(codeWarning({ commit: "13fa689", uncommitted: ["eval/prompts/f.ts"] })).toMatch(/uncommitted changes in eval\/prompts\/f\.ts/);
    expect(codeWarning({ commit: "13fa689", uncommitted: [] })).toBeNull();
  });
});

describe("describeCode", () => {
  it("names each commit a run's answers came from, and any uncommitted files", () => {
    expect(describeCode([{ commit: "13fa689", uncommitted: [] }])).toBe("Code: commit 13fa689.");
    expect(describeCode([{ commit: "13fa689", uncommitted: [] }, { commit: "abc1234", uncommitted: ["src/a.ts", "src/b.ts"] }]))
      .toBe("Code: commit 13fa689; commit abc1234, with uncommitted changes in src/a.ts, src/b.ts.");
  });
  it("says so for a run from before commits were recorded", () => {
    expect(describeCode(undefined)).toBe("Code: commit not recorded.");
  });
});
