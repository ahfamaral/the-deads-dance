import type { IngestStep } from "@corpus/ingest";
import type { Persona } from "@/lib/personas";

/** One line of the POST /api/personas stream. */
export type AddPersonaEvent =
  | { type: "progress"; step: IngestStep; status: "started" | "finished"; chunks?: number }
  | { type: "done"; persona: Persona }
  | { type: "error"; message: string };
