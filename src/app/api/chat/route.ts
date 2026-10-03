import { describeDbError } from "@corpus/db";
import { findPersona, type PersonaRow } from "@corpus/personas";
import type { ChatStreamEvent } from "@/lib/chat-types";
import { requireApproved } from "@/lib/server/access";
import { runTurn } from "@/lib/server/agent";
import { chatDeps, type ChatDeps } from "@/lib/server/chat-deps";
import { parseChatRequest, toAgentMessages } from "@/lib/server/chat-request";
import { chatEvents } from "@/lib/server/chat-stream";
import { renderConversationState } from "@/lib/server/conversation-state";
import { languagesFor } from "@/lib/server/persona-languages";
import { buildPersonaPrompt } from "@/lib/server/persona-prompt";
import { lockPersona } from "@/lib/server/persona-tools";
import { foldVisit } from "@/lib/visit";

function invalid(error: string, status = 400): Response {
  return Response.json({ error, code: "invalid_request" }, { status });
}

function unavailable(err: unknown): Response {
  console.error(err);
  return Response.json(
    { error: describeDbError(err) ?? (err instanceof Error ? err.message : "Server error"), code: "unavailable" },
    { status: 503 },
  );
}

/**
 * One chat turn (spec §16.2, §18). Validates first, so rejections get real HTTP statuses, then
 * streams newline-delimited JSON events, starting with the classifier's act for a turn (spec
 * §18.2). A visit that has ended (any ending, spec §23) refuses any further turn with 409, before
 * any dependency or model call. The visitor always speaks first: there is no arrival turn
 * (spec §18.5, revised 2026-09-29). Stateless: the browser sends the
 * history. Closing the tab or pressing Stop aborts request.signal, which stops the agent and its
 * model call.
 */
export async function POST(request: Request) {
  // Spec §24.5: approved users only, before reading the body or touching any dependency.
  let user: Awaited<ReturnType<typeof requireApproved>>;
  try {
    user = await requireApproved(request);
  } catch (err) {
    return unavailable(err); // spec §24.9: the database is down
  }
  if (user instanceof Response) return user;

  const contentType = request.headers.get("content-type") ?? "";
  if (!contentType.toLowerCase().startsWith("application/json")) return invalid("Expected a JSON body.", 415);

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return invalid("Expected a JSON body.");
  }
  const parsed = parseChatRequest(body);
  if (!parsed.ok) return invalid(parsed.error);
  const { personaId, messages, acts, languageMode } = parsed.value;
  // Spec §23: every ending is final. Best effort until conversations live server side (Phase 2b):
  // the acts come from the browser.
  if (foldVisit(acts).closed) {
    return Response.json({ error: "The persona has ended this conversation.", code: "conversation_ended" }, { status: 409 });
  }

  let deps: ChatDeps;
  let persona: PersonaRow | null;
  try {
    deps = chatDeps();
    persona = await findPersona(deps.pool, personaId);
  } catch (err) {
    return unavailable(err);
  }
  if (!persona || persona.status !== "ready") {
    return Response.json({ error: "This persona is no longer available.", code: "unknown_persona" }, { status: 404 });
  }

  const newest = messages.at(-1);
  const previous = messages.at(-2);
  // Spec §18.2: the classifier needs the profile, so it runs after findPersona, alongside getTools
  // and the languages backfill for personas stored without languages (spec §18.4).
  const [mcpTools, act, languages] = await Promise.all([
    deps.getTools(),
    !newest
      ? Promise.resolve(null)
      : deps.classifyVisitor({
          personaMessage: previous?.role === "persona" ? previous.text : null,
          visitorMessage: newest.text,
          profile: persona.profile,
          signal: request.signal,
        }),
    languagesFor(persona, deps),
  ]);
  const tools = mcpTools ? lockPersona(mcpTools, persona.slug) : [];
  const toolsAvailable = tools.length > 0;
  const visit = foldVisit([...acts, act]);
  // languagesFor applies the English fallback (spec §18.4).
  const state = renderConversationState({ visit, languages, languageMode });

  const events = chatEvents({
    personaId: persona.slug,
    ended: visit.ended ?? null,
    turn: runTurn({
      model: deps.model,
      tools,
      systemPrompt: buildPersonaPrompt(persona, { toolsAvailable, state }),
      messages: toAgentMessages(messages),
      signal: request.signal,
    }),
  });

  const encoder = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const send = (event: ChatStreamEvent) => controller.enqueue(encoder.encode(`${JSON.stringify(event)}\n`));
      try {
        send({ type: "act", act });
        if (!toolsAvailable) send({ type: "notice", code: "tools_unavailable" });
        for await (const event of events) send(event);
      } catch {
        // The client went away mid-stream; the aborted signal has already stopped the agent.
      } finally {
        try {
          controller.close();
        } catch {
          // Already closed by a cancelled client.
        }
      }
    },
  });
  return new Response(stream, { headers: { "Content-Type": "application/x-ndjson" } });
}
