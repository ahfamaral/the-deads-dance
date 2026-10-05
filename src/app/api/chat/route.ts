import { findPersona, type PersonaRow } from "@corpus/personas";
import type { ChatStreamEvent, HistoryMessage } from "@/lib/chat-types";
import { requireApproved, unavailable } from "@/lib/server/access";
import { runTurn } from "@/lib/server/agent";
import { chatDeps, type ChatDeps } from "@/lib/server/chat-deps";
import { parseChatRequest, toAgentMessages } from "@/lib/server/chat-request";
import { chatEvents } from "@/lib/server/chat-stream";
import { renderConversationState } from "@/lib/server/conversation-state";
import { beginTurn, findConversation, loadTurnContext, storeReply, type TurnContext } from "@/lib/server/conversations";
import { languagesFor } from "@/lib/server/persona-languages";
import { buildPersonaPrompt } from "@/lib/server/persona-prompt";
import { lockPersona } from "@/lib/server/persona-tools";
import { applyChatEvent, replyToStore, startTurn } from "@/lib/turn-state";
import { foldVisit } from "@/lib/visit";

function invalid(error: string, status = 400): Response {
  return Response.json({ error, code: "invalid_request" }, { status });
}
const conversationEnded = () =>
  Response.json({ error: "The persona has ended this conversation.", code: "conversation_ended" }, { status: 409 });
const unknownConversation = () =>
  Response.json({ error: "This conversation is no longer available.", code: "unknown_conversation" }, { status: 404 });
const NOTHING_STORED: TurnContext = { history: [], acts: [], unanswered: false };

/**
 * One chat turn (spec §16.2, §18, §25.3). The server owns the history: it reads the last
 * messages and every act from the database, stores the visitor message (locking an ending)
 * before streaming, and stores the reply when the stream ends, a partial one after Stop.
 * Validates first, so rejections get real HTTP statuses, then streams newline-delimited JSON,
 * starting with the classifier's act. Closing the tab or pressing Stop aborts request.signal,
 * which stops the agent and its model call.
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
  const { conversationId, personaId, text, retry, first, languageMode } = parsed.value;

  let deps: ChatDeps;
  let persona: PersonaRow | null;
  let context: TurnContext;
  try {
    deps = chatDeps();
    const existing = await findConversation(deps.pool, conversationId);
    // Someone else's conversation, or one deleted since this tab opened it: only a first message creates one.
    if (existing ? existing.userId !== user.id : !first) return unknownConversation();
    if (existing && existing.personaSlug !== personaId) return invalid("This conversation is with another persona.");
    context = existing ? await loadTurnContext(deps.pool, conversationId) : NOTHING_STORED;
    // Spec §23: every ending is final, read from the server's own record, before any model call.
    if (existing?.ended || foldVisit(context.acts).closed) return conversationEnded();
    if (retry && !context.unanswered) {
      return Response.json({ error: "There's nothing to retry.", code: "nothing_to_retry" }, { status: 409 });
    }
    persona = await findPersona(deps.pool, personaId);
  } catch (err) {
    return unavailable(err, { showMessage: true });
  }
  if (!persona || persona.status !== "ready") {
    return Response.json({ error: "This persona is no longer available.", code: "unknown_persona" }, { status: 404 });
  }

  // On Retry the visitor message is already stored, with its act: nothing is classified again.
  const visitorText = retry ? context.history.at(-1)!.text : text!;
  const before = retry ? context.history.slice(0, -1) : context.history;
  const previous = before.at(-1);
  // Spec §18.2: the classifier needs the profile, so it runs after findPersona, alongside getTools
  // and the languages backfill for personas stored without languages (spec §18.4).
  const [mcpTools, act, languages] = await Promise.all([
    deps.getTools(),
    retry
      ? Promise.resolve(context.acts.at(-1) ?? null)
      : deps.classifyVisitor({
          personaMessage: previous?.role === "persona" ? previous.text : null,
          visitorMessage: visitorText,
          profile: persona.profile,
          signal: request.signal,
        }),
    languagesFor(persona, deps),
  ]);
  // Stop during classification: the classifier returns null on abort, and a message stored with a null
  // act would escape the ending rules (foldVisit ignores it). The client has gone; store nothing.
  if (request.signal.aborted) return new Response(null, { status: 499 });
  const visit = foldVisit(retry ? context.acts : [...context.acts, act]);
  const history: HistoryMessage[] = [...before, { role: "user", text: visitorText }];

  let begun: Awaited<ReturnType<typeof beginTurn>>;
  try {
    begun = await beginTurn(deps.pool, {
      conversationId,
      userId: user.id,
      personaSlug: persona.slug,
      personaName: persona.displayName,
      visitor: retry ? null : { text: visitorText, act },
      ending: visit.ended,
      create: first === true && !retry,
    });
  } catch (err) {
    return unavailable(err, { showMessage: true });
  }
  if (!begun.ok) return begun.reason === "ended" ? conversationEnded() : unknownConversation();

  const tools = mcpTools ? lockPersona(mcpTools, persona.slug) : [];
  const toolsAvailable = tools.length > 0;
  // languagesFor applies the English fallback (spec §18.4).
  const state = renderConversationState({ visit, languages, languageMode });
  const events = chatEvents({
    personaId: persona.slug,
    ended: visit.ended ?? null,
    turn: runTurn({
      model: deps.model,
      tools,
      systemPrompt: buildPersonaPrompt(persona, { toolsAvailable, state }),
      messages: toAgentMessages(history),
      signal: request.signal,
    }),
  });

  const pool = deps.pool;
  const encoder = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      // Built from the same events the browser gets, so what's stored is what the visitor saw.
      let turn = startTurn("reply");
      const send = (event: ChatStreamEvent) => controller.enqueue(encoder.encode(`${JSON.stringify(event)}\n`));
      try {
        send({ type: "act", act });
        if (!toolsAvailable) send({ type: "notice", code: "tools_unavailable" });
        for await (const event of events) {
          turn = applyChatEvent(turn, event);
          send(event);
        }
      } catch {
        // The client went away mid-stream; the aborted signal has already stopped the agent.
      } finally {
        const reply = replyToStore(turn, { aborted: request.signal.aborted, ended: visit.ended });
        // Spec §25.3: a failed store is logged; the visitor still has the reply on screen.
        if (reply) await storeReply(pool, conversationId, reply).catch((err) => console.error(err));
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
