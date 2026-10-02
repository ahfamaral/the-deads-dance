import type { AddPersonaEvent } from "./add-persona-events";

type ProgressEvent = Extract<AddPersonaEvent, { type: "progress" }>;

export const SEGMENTS = ["split", "index", "character", "save"] as const;
export type Segment = (typeof SEGMENTS)[number];
export type SegmentState = "waiting" | "running" | "done";
export type ProgressState = { segments: Record<Segment, SegmentState>; chunks?: number };

export const LONG_WAIT_HINT = "Long articles can take up to a minute.";

/** "fetching" has no segment: for a user add it happens before the stream opens (spec §17.5). */
const SEGMENT_FOR: Partial<Record<ProgressEvent["step"], Segment>> = {
  chunking: "split",
  embedding: "index",
  profiling: "character",
  saving: "save",
};

export function initialProgress(): ProgressState {
  return { segments: { split: "waiting", index: "waiting", character: "waiting", save: "waiting" } };
}

/** Spec §17.5: a pure reducer, so every finishing order is tested without a browser. */
export function applyProgress(state: ProgressState, event: ProgressEvent): ProgressState {
  const segment = SEGMENT_FOR[event.step];
  if (!segment) return state;
  const segments = { ...state.segments, [segment]: event.status === "started" ? "running" : "done" };
  if (segment === "save" && event.status === "started") {
    // Everything before saving has ended, including a stage that never ran (a pinned profile).
    for (const s of SEGMENTS) if (s !== "save") segments[s] = "done";
  }
  return { segments, chunks: event.chunks ?? state.chunks };
}

export function progressView(state: ProgressState) {
  const s = state.segments;
  const passages = state.chunks ? `${state.chunks} passages` : "the passages";
  let line = "Working…";
  if (s.save === "running") line = "Saving…";
  else if (s.index === "running" && s.character === "running") line = `Indexing ${passages} and reading for character…`;
  else if (s.character === "running") line = "Reading for character: temperament, humour, sore points…";
  else if (s.index === "running") line = `Indexing ${passages} for search…`;
  else if (s.split === "running") line = "Splitting the biography into passages…";
  return {
    segments: SEGMENTS.map((key) => ({ key, state: s[key] })),
    finished: SEGMENTS.filter((key) => s[key] === "done").length,
    line,
  };
}
