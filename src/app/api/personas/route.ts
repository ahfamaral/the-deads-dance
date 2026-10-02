import {
  AddPersonaError,
  prepareUserPersona,
  type AddPersonaErrorCode,
  type PreparedPersona,
} from "@corpus/add-persona";
import { describeDbError } from "@corpus/db";
import { EmbeddingDimensionError } from "@corpus/embeddings";
import { IngestError, ingestPersona } from "@corpus/ingest";
import { toSummary } from "@corpus/personas";
import { WikipediaError } from "@corpus/wikipedia";
import type { AddPersonaEvent } from "@/lib/add-persona-events";
import { toPersona } from "@/lib/personas";
import { corpusDeps } from "@/lib/server/corpus-deps";

const STATUS: Record<AddPersonaErrorCode, number> = {
  invalid_title: 400,
  not_found: 404,
  disambiguation: 422,
  not_a_person: 422,
  not_deceased: 422,
  too_large: 422,
  conflict: 409,
  unreachable: 502,
};

function messageFor(err: unknown): string {
  if (err instanceof IngestError || err instanceof WikipediaError) return err.message;
  if (err instanceof EmbeddingDimensionError) return "The embedding model is misconfigured. Check the server log.";
  return describeDbError(err) ?? "Adding the persona failed. Try again in a moment.";
}

function unavailable(err: unknown): Response {
  console.error(err);
  return Response.json(
    { error: describeDbError(err) ?? (err instanceof Error ? err.message : "Server error"), code: "unavailable" },
    { status: 503 },
  );
}

/**
 * Validates first, so rejections get real HTTP statuses. Then streams ingest progress as
 * newline-delimited JSON. The ingest is not tied to the request: if the user closes the
 * form, it still finishes, and the persona shows up on the next load (or ends 'failed').
 */
export async function POST(request: Request) {
  const contentType = request.headers.get("content-type") ?? "";
  if (!contentType.toLowerCase().startsWith("application/json")) {
    return Response.json({ error: "Expected a JSON body.", code: "invalid_title" }, { status: 415 });
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: "Expected a JSON body.", code: "invalid_title" }, { status: 400 });
  }
  const raw = (body as { wikipediaTitle?: unknown } | null)?.wikipediaTitle;
  const title = typeof raw === "string" ? raw : "";

  let deps: ReturnType<typeof corpusDeps>;
  try {
    deps = corpusDeps();
  } catch (err) {
    return unavailable(err);
  }

  let prepared: PreparedPersona;
  try {
    prepared = await prepareUserPersona(title, deps);
  } catch (err) {
    if (err instanceof AddPersonaError) {
      return Response.json(
        { error: err.message, code: err.code, persona: err.existing ? toPersona(err.existing) : undefined },
        { status: STATUS[err.code] },
      );
    }
    return unavailable(err);
  }

  const encoder = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      const send = (event: AddPersonaEvent) => {
        try {
          controller.enqueue(encoder.encode(`${JSON.stringify(event)}\n`));
        } catch {
          // The client went away; the ingest carries on regardless.
        }
      };
      ingestPersona(prepared.entry, deps, {
        article: prepared.article,
        onProgress: (p) => send({ type: "progress", ...p }),
      })
        .then((result) => send({ type: "done", persona: toPersona(toSummary(result.persona)) }))
        .catch((err) => {
          console.error(err);
          send({ type: "error", message: messageFor(err) });
        })
        .finally(() => {
          try {
            controller.close();
          } catch {
            // Already closed by a cancelled client.
          }
        });
    },
  });
  return new Response(stream, { headers: { "Content-Type": "application/x-ndjson" } });
}
