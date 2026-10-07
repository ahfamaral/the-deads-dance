import { describe, expect, it } from "vitest";
import { addEnergyPreview, creditWarnings, energyCell, gapTooBig, startingEnergyConfirm, type SpendReport } from "@/lib/admin-spend";

const report = (credit: SpendReport["credit"], held = 0): SpendReport => ({
  credit, held, logged: { today: { tokens: 0, cost: 0 }, week: { tokens: 0, cost: 0 }, month: { tokens: 0, cost: 0 } },
});
const key = (limit: number | null, remaining: number | null) => ({ limit, remaining, billed: { today: 0, week: 0, month: 0 } });

describe("admin spend text (spec §26.6)", () => {
  it("warns when testers hold more energy than the key has left", () => {
    expect(creditWarnings(report(key(10_000_000, 6_400_000), 7_100_000))).toEqual([
      "Testers still hold $7.10 of energy, more than the $6.40 left on the key. Raise the key limit on OpenRouter.",
    ]);
    expect(creditWarnings(report(key(10_000_000, 6_400_000), 1_000_000))).toEqual([]);
  });
  it("warns about a key with no limit, or one that couldn't be checked", () => {
    expect(creditWarnings(report(key(null, null)))).toEqual(["The key has no credit limit. Set one on OpenRouter."]);
    expect(creditWarnings(report(null))).toEqual(["Couldn't check OpenRouter credit."]);
  });
  it("flags a logged-vs-billed gap over 5%", () => {
    expect(gapTooBig(3_600_000, 3_550_000)).toBe(false);
    expect(gapTooBig(3_600_000, 3_000_000)).toBe(true);
    expect(gapTooBig(0, 0)).toBe(false);
  });
  it("previews a top-up and shows each tester's energy", () => {
    expect(addEnergyPreview(140_000, 1_000_000)).toBe("They have $0.14 left. After this: $1.14, and their bar is full again.");
    expect(addEnergyPreview(-20_000, 1_000_000)).toBe("They have $0.00 left. After this: $0.98, and their bar is full again.");
    expect(energyCell(140_000, 1_000_000)).toBe("$0.14 of $1.00");
    expect(energyCell(-20_000, 1_000_000)).toBe("Empty (−$0.02)");
    expect(energyCell(0, 0)).toBe("Empty");
  });
});

describe("startingEnergyConfirm", () => {
  it("says what new testers will get, and that approved testers keep theirs", () => {
    expect(startingEnergyConfirm(1_000_000, 500_000)).toBe(
      "New testers will get $0.50 when approved (was $1.00). Testers already approved keep their energy.",
    );
  });
});
