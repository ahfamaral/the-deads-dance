import { readNdjson } from "@/lib/ndjson";
import type { RoundEvent } from "@/lib/persona-profile";
import type { SourcePlan } from "@corpus/plan-changes";

export type RoundRequest = ({ slug: string } | { title: string }) & { plan: SourcePlan };

/**
 * Spec §34.6: starts a round and hands on each event. The server answers only once the round's
 * first paid call starts (texts are fetched first), so the request may stay pending a while; a
 * refusal before that (409 round_running, 422 too_large, 502) arrives as JSON and is handed on as
 * an `error` event, as is a stream that stops before `done`. Never throws.
 */
export async function streamRound(body: RoundRequest, onEvent: (e: RoundEvent) => void, fetchFn: typeof fetch = fetch): Promise<void> {
  let res: Response;
  try {
    res = await fetchFn("/api/admin/personas/rounds", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
  } catch {
    onEvent({ type: "error", message: "Couldn't reach the server." });
    return;
  }
  const streaming = (res.headers.get("content-type") ?? "").includes("application/x-ndjson");
  if (!res.ok || !streaming || !res.body) {
    const data = (await res.json().catch(() => ({}))) as { error?: string; code?: string };
    onEvent({ type: "error", message: data.error ?? "The round failed. Try again in a moment.", ...(data.code ? { code: data.code } : {}) });
    return;
  }
  try {
    for await (const event of readNdjson<RoundEvent>(res.body)) {
      onEvent(event);
      if (event.type !== "progress") return;
    }
  } catch {
    // The connection dropped mid-stream.
  }
  onEvent({ type: "error", message: "The connection was lost. The round may still be running; the profile shows how it ended." });
}
