import { describe, expect, it } from "vitest";
import type { AddPersonaEvent } from "@/lib/add-persona-events";
import { applyProgress, initialProgress, progressView, type ProgressState } from "@/lib/add-persona-progress";

type ProgressEvent = Extract<AddPersonaEvent, { type: "progress" }>;
const ev = (step: ProgressEvent["step"], status: ProgressEvent["status"], chunks?: number): ProgressEvent => ({
  type: "progress",
  step,
  status,
  chunks,
});
const run = (...events: ProgressEvent[]): ProgressState => events.reduce(applyProgress, initialProgress());
const states = (s: ProgressState) => progressView(s).segments.map((x) => x.state);

describe("add-persona progress", () => {
  it("starts with every segment waiting", () => {
    expect(states(initialProgress())).toEqual(["waiting", "waiting", "waiting", "waiting"]);
  });

  it("shows splitting, then indexing with the passage count", () => {
    const split = run(ev("chunking", "started"));
    expect(progressView(split)).toMatchObject({ finished: 0, line: "Splitting the biography into passages…" });
    const index = run(ev("chunking", "started"), ev("chunking", "finished"), ev("embedding", "started", 63));
    expect(states(index)).toEqual(["done", "running", "waiting", "waiting"]);
    expect(progressView(index)).toMatchObject({ finished: 1, line: "Indexing 63 passages for search…" });
  });

  it("names both jobs while indexing and reading for character run together", () => {
    const both = run(ev("chunking", "started"), ev("chunking", "finished"), ev("embedding", "started", 63), ev("profiling", "started"));
    expect(states(both)).toEqual(["done", "running", "running", "waiting"]);
    expect(progressView(both).line).toBe("Indexing 63 passages and reading for character…");
  });

  it("names whichever job is left, in either finishing order", () => {
    const start = [ev("chunking", "started"), ev("chunking", "finished"), ev("embedding", "started", 63), ev("profiling", "started")];
    expect(progressView(run(...start, ev("embedding", "finished", 63))).line).toBe(
      "Reading for character: temperament, humour, sore points…",
    );
    expect(progressView(run(...start, ev("profiling", "finished"))).line).toBe("Indexing 63 passages for search…");
  });

  it("marks every earlier segment done once saving starts, even one that never ran", () => {
    const saving = run(ev("chunking", "started"), ev("chunking", "finished"), ev("embedding", "started", 5), ev("embedding", "finished", 5), ev("saving", "started"));
    expect(states(saving)).toEqual(["done", "done", "done", "running"]);
    expect(progressView(saving)).toMatchObject({ finished: 3, line: "Saving…" });
  });

  // Review Focus 4: a step with no segment, or odd ordering, never throws.
  it("ignores fetching and tolerates out-of-order events", () => {
    expect(states(run(ev("fetching", "started"), ev("fetching", "finished")))).toEqual(["waiting", "waiting", "waiting", "waiting"]);
    const odd = run(ev("profiling", "finished"), ev("embedding", "started"));
    expect(states(odd)).toEqual(["waiting", "running", "done", "waiting"]);
    expect(progressView(odd).line).toBe("Indexing the passages for search…");
  });

  it("never names the persona with a pronoun", () => {
    const lines = [
      run(ev("chunking", "started")),
      run(ev("embedding", "started", 2), ev("profiling", "started")),
      run(ev("profiling", "started")),
      run(ev("saving", "started")),
    ].map((s) => progressView(s).line);
    for (const line of lines) expect(line).not.toMatch(/\b(he|she|his|her|him|they|their)\b/i);
  });
});
