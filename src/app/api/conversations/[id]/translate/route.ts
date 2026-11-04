import { z } from "zod";
import { CostLedger } from "@corpus/cost-ledger";
import { requireApproved, unavailable } from "@/lib/server/access";
import { translatePassage } from "@/lib/server/passage-translations";
import { recordCalls } from "@/lib/server/spend";
import { translateDeps } from "@/lib/server/translate-deps";
import { passagesIn } from "@/lib/tool-display";

const gone = () =>
  Response.json({ error: "This passage is no longer available.", code: "unknown_passage" }, { status: 404 });
const isId = (id: string) => z.uuid().safeParse(id).success;

const Body = z.strictObject({ chunkId: z.number().int(), to: z.string().regex(/^[a-z]{2}$/) });

/**
 * Spec §34.6: a source chip's passage in the visitor's language. The passage is looked up in the
 * conversation's own stored tool results, never taken from the request, so this can't be used to
 * translate arbitrary text. A conversation that isn't yours (the admin may read any) or a chunk
 * that isn't in it is a 404, before any model call.
 */
export async function POST(request: Request, ctx: RouteContext<"/api/conversations/[id]/translate">) {
  try {
    const user = await requireApproved(request);
    if (user instanceof Response) return user;
    const { id } = await ctx.params;
    if (!isId(id)) return gone();
    const body = Body.safeParse(await request.json().catch(() => null));
    if (!body.success) return Response.json({ error: "Say which passage and language.", code: "invalid_request" }, { status: 400 });
    const deps = translateDeps();

    const { rows } = await deps.pool.query(
      `SELECT c.persona_slug, m.tool_calls
         FROM conversations c JOIN messages m ON m.conversation_id = c.id
        WHERE c.id = $1 AND ($3::boolean OR c.user_id = $2) AND m.tool_calls IS NOT NULL`,
      [id, user.id, user.role === "admin"],
    );
    const passage = rows
      .flatMap((r) => (Array.isArray(r.tool_calls) ? r.tool_calls : []))
      .filter((call: { status?: unknown }) => call?.status === "ok")
      .flatMap((call: { result?: unknown }) => passagesIn(call.result))
      .find((p) => p.chunk_id === body.data.chunkId);
    if (!passage) return gone();

    const from = passage.language ?? "en";
    const original = { heading: passage.section_heading, content: passage.content, from };
    if (from === body.data.to) return Response.json(original);

    const ledger = new CostLedger();
    try {
      const done = await translatePassage(
        deps.pool,
        { heading: passage.section_heading, content: passage.content, to: body.data.to },
        deps.translator([ledger.handler("helper")]),
      );
      return Response.json({ heading: done.heading, content: done.content, from });
    } catch (err) {
      console.error(err);
      return Response.json({ error: "Couldn't translate this passage.", code: "translate_failed" }, { status: 502 });
    } finally {
      if (ledger.calls.length > 0) {
        try {
          const calls = await deps.resolveCosts(ledger.calls);
          await recordCalls(deps.pool, { userId: user.id, calls, charge: true, personaSlug: rows[0]?.persona_slug, conversationId: id });
        } catch (err) {
          console.error(err);
        }
      }
    }
  } catch (err) {
    return unavailable(err);
  }
}
