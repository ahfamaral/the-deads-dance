import type { CostLedger } from "@corpus/cost-ledger";
import { runRound, type RoundDeps, type RoundResult } from "@corpus/reingest";
import { runningRound } from "@corpus/rounds";
import { RoundBody, type RoundEvent } from "@/lib/persona-profile";
import { requireAdmin, unavailable } from "@/lib/server/access";
import {
  adminDeps, adminError, isStaleRound, resolveTarget, roundDeps, roundErrorEvent, roundTarget, type AdminTarget,
} from "@/lib/server/persona-admin";

/** Spec §34.6: a round fetches, embeds and swaps; up to the function limit. */
export const maxDuration = 300;

type Outcome = { ok: true; result: RoundResult } | { ok: false; err: unknown };

/**
 * Spec §34.6: runs one round and streams its progress as newline-delimited JSON.
 *
 * Everything free comes first (who, the reingest lock, fetching and sizing every text), and its
 * refusals are real HTTP statuses: 409 `round_running` before any fetch (Review Focus 1), 422
 * `too_large`, 502 when Wikimedia is unreachable. The stream opens at the first paid call. The
 * round is not tied to the request: if the admin closes the tab, it still finishes and records
 * its costs.
 */
export async function POST(request: Request) {
  let admin: Awaited<ReturnType<typeof requireAdmin>>;
  try {
    admin = await requireAdmin(request);
  } catch (err) {
    return unavailable(err);
  }
  if (admin instanceof Response) return admin;

  const contentType = request.headers.get("content-type") ?? "";
  if (!contentType.toLowerCase().startsWith("application/json")) {
    return Response.json({ error: "Expected a JSON body.", code: "invalid_request" }, { status: 415 });
  }
  const body = RoundBody.safeParse(await request.json().catch(() => null));
  if (!body.success) return Response.json({ error: "The round's plan is malformed.", code: "invalid_request" }, { status: 400 });
  const { plan } = body.data;

  let target: AdminTarget;
  let real: RoundDeps;
  try {
    const deps = adminDeps();
    // A slug is a database lookup only, so a second reingest is refused before any fetch. A new
    // persona's slug is claimed only at the swap, after embeddings are paid (spec §34.6), so it must
    // be free now: prepareUserPersona's checks refuse a taken slug, and a living person.
    const resolved = await resolveTarget("slug" in body.data ? { slug: body.data.slug } : { title: body.data.title }, deps);
    if (!resolved) return Response.json({ error: "No such persona.", code: "not_found" }, { status: 404 });
    target = resolved;
    const running = await runningRound(deps.pool, target.slug);
    if (running && !isStaleRound(running)) {
      return Response.json({ error: "A round is already running for this persona.", code: "round_running" }, { status: 409 });
    }
    real = roundDeps(admin.id, target.slug);
  } catch (err) {
    return adminError(err);
  }

  // Events wait here until the stream opens.
  const pending: RoundEvent[] = [];
  let controller: ReadableStreamDefaultController<Uint8Array> | null = null;
  const encoder = new TextEncoder();
  const send = (event: RoundEvent) => {
    if (!controller) {
      pending.push(event);
      return;
    }
    try {
      controller.enqueue(encoder.encode(`${JSON.stringify(event)}\n`));
    } catch {
      // The client went away; the round carries on regardless.
    }
  };

  let paid = false;
  let openStream!: () => void;
  const opened = new Promise<void>((resolve) => (openStream = resolve));
  const onPaid = <T,>(make: (ledger: CostLedger) => T) => (ledger: CostLedger) => {
    paid = true;
    openStream();
    return make(ledger);
  };
  const deps: RoundDeps = {
    ...real,
    embeddings: onPaid(real.embeddings),
    generateProfile: onPaid(real.generateProfile),
    draftHighlights: onPaid(real.draftHighlights),
  };

  const outcome: Promise<Outcome> = runRound(roundTarget(target), plan, admin.id, deps, (p) => send({ type: "progress", ...p })).then(
    (result) => ({ ok: true, result }),
    (err) => ({ ok: false, err }),
  );
  await Promise.race([opened, outcome]);
  if (!paid) {
    const settled = await outcome;
    if (!settled.ok) return adminError(settled.err);
  }

  const stream = new ReadableStream<Uint8Array>({
    start(c) {
      controller = c;
      for (const event of pending.splice(0)) send(event);
      void outcome.then((settled) => {
        if (settled.ok) send({ type: "done", slug: settled.result.persona.slug, cost: settled.result.cost });
        else {
          console.error(settled.err);
          send(roundErrorEvent(settled.err));
        }
        try {
          c.close();
        } catch {
          // Already closed by a cancelled client.
        }
      });
    },
  });
  return new Response(stream, { headers: { "Content-Type": "application/x-ndjson" } });
}
