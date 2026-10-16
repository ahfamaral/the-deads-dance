import { describe, expect, it } from "vitest";
import { PREVIEW_CHARS, canDelete, cutPreview, ownerLine, type ConversationSummary } from "@/lib/conversation-types";

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

describe("History's owner line and Delete (spec §27)", () => {
  const row = (extra: Partial<ConversationSummary> = {}): ConversationSummary => ({
    id: "c", personaId: "wu", personaName: "Wu", preview: null, updatedAt: "2026-10-07T00:00:00.000Z", ended: null, stars: null, ...extra,
  });
  it("shows the owner's email, 'you' for the admin's own, and nothing in a tester's list", () => {
    expect(ownerLine(row({ userEmail: "ana@example.com", mine: false }))).toBe("ana@example.com");
    expect(ownerLine(row({ userEmail: "boss@example.com", mine: true }))).toBe("you");
    expect(ownerLine(row())).toBeNull();
  });
  it("offers Delete on your own conversations only", () => {
    expect(canDelete(row())).toBe(true);
    expect(canDelete(row({ mine: true }))).toBe(true);
    expect(canDelete(row({ mine: false }))).toBe(false);
  });
});
