import { describe, expect, it } from "vitest";
import type { Message, ToolCall } from "@/lib/chat-types";
import {
  explanationOf,
  GENERAL_KNOWLEDGE_NOTE,
  historicalContextOf,
  MIXED_SOURCES_NOTE,
  passagesById,
  problemOf,
  queriesOf,
  recalledOf,
  toolLabel,
  toolSubject,
  usesGeneralKnowledge,
  VERDICT_LABELS,
  verdictOf,
} from "@/lib/tool-display";

const passage = (id: number) => ({ chunk_id: id, section_heading: `S${id}`, content: `text ${id}` });
const call = (overrides: Partial<ToolCall>): ToolCall => ({
  id: "t1",
  toolName: "search_biography",
  arguments: { query: "parity" },
  status: "ok",
  ...overrides,
});

describe("tool display helpers", () => {
  it("labels known tools and falls back to the raw name", () => {
    expect(toolLabel("search_biography")).toBe("Searched biography");
    expect(toolLabel("fact_check_claim")).toBe("Fact-checked claim");
    expect(toolLabel("mystery")).toBe("mystery");
  });

  it("shows the query or the claim as the subject", () => {
    expect(toolSubject(call({}))).toBe("parity");
    expect(toolSubject(call({ toolName: "fact_check_claim", arguments: { claim: "I won a Nobel" } }))).toBe("I won a Nobel");
    expect(toolSubject(call({ arguments: {} }))).toBeNull();
  });

  it("reads the verdict and explanation of a fact check", () => {
    const check = call({
      toolName: "fact_check_claim",
      result: { status: "ok", verdict: "contradicted", passage: passage(1), explanation: "Passage 1 disagrees." },
    });
    expect(verdictOf(check)).toBe("contradicted");
    expect(explanationOf(check)).toBe("Passage 1 disagrees.");
    expect(verdictOf(call({ result: { status: "ok", passages: [] } }))).toBeNull();
  });

  // Spec §19.5: a recall answer is labelled as general knowledge, never as the biography.
  it("reads a known_elsewhere verdict and what was recalled", () => {
    const check = call({
      toolName: "fact_check_claim",
      result: {
        status: "ok",
        verdict: "known_elsewhere",
        recalled: { account: "Played a match in Rio with Chico Buarque.", year: 1980 },
        explanation: "The biography doesn't cover this; it is widely recorded elsewhere.",
      },
    });
    expect(verdictOf(check)).toBe("known_elsewhere");
    expect(recalledOf(check)).toEqual({ account: "Played a match in Rio with Chico Buarque.", year: 1980 });
    expect(VERDICT_LABELS.known_elsewhere).toBe("general knowledge");
    expect(GENERAL_KNOWLEDGE_NOTE).toBe("Not in the biography; from the model's general knowledge.");
  });

  it("has no recall for other results, or a malformed one", () => {
    const withRecalled = (recalled: unknown) =>
      call({ toolName: "fact_check_claim", result: { status: "ok", verdict: "known_elsewhere", recalled, explanation: "x" } });
    expect(recalledOf(call({ result: { status: "ok", verdict: "not_mentioned", explanation: "x" } }))).toBeNull();
    expect(recalledOf(withRecalled(undefined))).toBeNull();
    expect(recalledOf(withRecalled({ account: "x" }))).toBeNull();
    expect(recalledOf(withRecalled({ account: 3, year: 1980 }))).toBeNull();
    expect(recalledOf({ ...withRecalled({ account: "x", year: 1980 }), status: "error" })).toBeNull();
  });

  // Deferred minor: a malformed result must not show an account next to another verdict's badge.
  it("shows no recalled account under a verdict other than known_elsewhere", () => {
    const recalled = { account: "Played a match in Rio.", year: 1980 };
    for (const verdict of ["supported", "contradicted", "not_mentioned", undefined]) {
      const check = call({ toolName: "fact_check_claim", result: { status: "ok", verdict, recalled, explanation: "x" } });
      expect(recalledOf(check)).toBeNull();
    }
  });

  // Deferred minor: the Football chip under the Rio answer needs the note that recall was used too.
  it("flags a message whose answer drew on general knowledge", () => {
    const search = call({ result: { status: "ok", passages: [passage(1)], queries: ["q"] } });
    const recall = call({
      id: "t2",
      toolName: "fact_check_claim",
      result: { status: "ok", verdict: "known_elsewhere", recalled: { account: "Rio.", year: 1980 }, explanation: "x" },
    });
    const message = (toolCalls: ToolCall[]): Message => ({ id: "m", role: "persona", text: "…", toolCalls });
    expect(usesGeneralKnowledge(message([search, recall]))).toBe(true);
    expect(usesGeneralKnowledge(message([search]))).toBe(false);
    expect(usesGeneralKnowledge({ id: "m", role: "persona", text: "…" })).toBe(false);
    expect(MIXED_SOURCES_NOTE).toBe("Part of this answer is from general knowledge, not these passages.");
  });

  it("labels the world tool and shows its year as the subject", () => {
    const world = call({ toolName: "get_historical_context", arguments: { year: 1905 } });
    expect(toolLabel("get_historical_context")).toBe("Looked up the times");
    expect(toolSubject(world)).toBe("1905");
  });

  it("reads the events and leaders of a historical context", () => {
    const events = [{ label: "Battle of Tsushima", date: "1905-05-28" }];
    const leaders = [{ country: "United States", office: "President of the United States", person: "Theodore Roosevelt" }];
    const world = call({ toolName: "get_historical_context", result: { status: "ok", year: 1905, events, leaders } });
    expect(historicalContextOf(world)).toEqual({ year: 1905, events, leaders });
    expect(historicalContextOf(call({ result: { status: "ok", passages: [] } }))).toBeNull();
    expect(historicalContextOf(call({ toolName: "get_historical_context", result: { status: "ok", year: 1905, events: [{ label: 3 }], leaders: "x" } }))).toEqual({
      year: 1905,
      events: [],
      leaders: [],
    });
  });

  it("explains an empty historical context", () => {
    const world = call({ toolName: "get_historical_context", result: { status: "empty", year: 1969, reason: "That year came after your death." } });
    expect(problemOf(world)).toBe("That year came after your death.");
  });

  it("lists the queries a search used", () => {
    expect(queriesOf(call({ result: { status: "ok", passages: [], queries: ["parity", "beta decay"] } }))).toEqual([
      "parity",
      "beta decay",
    ]);
    expect(queriesOf(call({ status: "running" }))).toEqual([]);
  });

  it("explains failed, unavailable and empty results", () => {
    expect(problemOf(call({ status: "error", result: { error: "Not connected" } }))).toBe("Not connected");
    expect(problemOf(call({ result: { status: "unavailable", reason: "Database down" } }))).toBe("Database down");
    expect(problemOf(call({ result: { status: "empty", queries: [] } }))).toBe("Nothing found in the biography.");
    expect(problemOf(call({ result: { status: "ok", passages: [passage(1)], queries: [] } }))).toBeNull();
    expect(problemOf(call({ status: "running" }))).toBeNull();
  });

  it("maps chunk ids to passages across a message's tool results", () => {
    const message: Message = {
      id: "p1",
      role: "persona",
      text: "…",
      toolCalls: [
        call({ result: { status: "ok", passages: [passage(1), passage(2)], queries: [] } }),
        call({ id: "t2", toolName: "fact_check_claim", result: { status: "ok", verdict: "supported", passage: passage(3), explanation: "" } }),
        call({ id: "t3", status: "error", result: { error: "x" } }),
      ],
    };
    expect([...passagesById(message).keys()]).toEqual([1, 2, 3]);
    expect(passagesById({ id: "old", role: "persona", text: "No trace." }).size).toBe(0);
  });
});
