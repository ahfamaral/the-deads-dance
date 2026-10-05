import { describe, expect, it } from "vitest";
import { PREVIEW_CHARS, cutPreview } from "@/lib/conversation-types";

describe("cutPreview (spec §25.4)", () => {
  it("keeps a short first message as it is", () => {
    expect(cutPreview("What did you discover?")).toBe("What did you discover?");
  });

  // Review Focus 4: one line, whatever the visitor typed.
  it("collapses newlines and runs of spaces into one line", () => {
    expect(cutPreview("  Hello,\n\nprofessor   Wu.\t")).toBe("Hello, professor Wu.");
  });

  it("cuts a long message at 120 characters and marks the cut", () => {
    const cut = cutPreview("word ".repeat(60));
    expect(cut!.endsWith("…")).toBe(true);
    expect(cut!.length).toBeLessThanOrEqual(PREVIEW_CHARS + 1);
  });

  it("is null when there is no visitor message", () => {
    expect(cutPreview(null)).toBeNull();
  });
});
