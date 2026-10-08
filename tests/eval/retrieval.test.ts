import { describe, expect, it } from "vitest";
import { scoreRetrieval } from "../../eval/retrieval";
import type { ToolCall } from "@/lib/chat-types";

const search = (...sections: string[]): ToolCall => ({
  id: "s", toolName: "search_biography", arguments: { query: "q" }, status: "ok",
  result: { status: "ok", queries: ["q"], passages: sections.map((s, i) => ({ chunk_id: i, section_heading: s, content: "x" })) },
});

describe("scoreRetrieval (spec §29.6)", () => {
  it("finds the labelled section's rank in the first search", () => {
    expect(scoreRetrieval([search("A", "B", "C")], "B")).toEqual({ recallAt3: true, reciprocalRank: 0.5 });
    expect(scoreRetrieval([search("A", "B", "C", "D")], "D")).toEqual({ recallAt3: false, reciprocalRank: 0.25 });
    expect(scoreRetrieval([search("A")], "Z")).toEqual({ recallAt3: false, reciprocalRank: 0 });
  });
  it("is not scored without a label or without a search", () => {
    expect(scoreRetrieval([search("A")], undefined)).toBeNull();
    expect(scoreRetrieval([], "A")).toBeNull();
  });
});
