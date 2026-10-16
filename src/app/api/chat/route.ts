import { CostLedger } from "@corpus/cost-ledger";
import { findPersona, type PersonaRow } from "@corpus/personas";
import { energyLeft } from "@/lib/energy";
import type { ChatStreamEvent, HistoryMessage, Message } from "@/lib/chat-types";
import { requireApproved, unavailable } from "@/lib/server/access";
import { runTurn } from "@/lib/server/agent";
import { chatDeps, type ChatDeps } from "@/lib/server/chat-deps";
import { parseChatRequest, toAgentMessages } from "@/lib/server/chat-request";
import { chatEvents } from "@/lib/server/chat-stream";
import { renderConversationState } from "@/lib/server/conversation-state";
import { beginTurn, findConversation, loadTurnContext, settleTurn, type TurnContext } from "@/lib/server/conversations";
import { languagesFor } from "@/lib/server/persona-languages";
import { buildPersonaPrompt } from "@/lib/server/persona-prompt";
import { findVoice, type StoredVoice } from "@/lib/server/persona-voices";
import { recordCalls } from "@/lib/server/spend";
import { lockPersona } from "@/lib/server/persona-tools";
import { turnInstructions } from "@/lib/server/voice-draft";
import { speakReply } from "@/lib/server/voice-turn";
import { applyChatEvent, replyToStore, startTurn } from "@/lib/turn-state";
import { foldVisit } from "@/lib/visit";
import { voiceLanguages } from "@/lib/voice";

/** Spec §31.4: Vercel's limit for one answer. Twice Haiku's slowest measured (55 s); within the 2-minute running-turn lock. */
export const maxDuration = 120;

function invalid(error: string, status = 400): Response {
  return Response.json({ error, code: "invalid_request" }, { status });
}
const conversationEnded = () =>
  Response.json({ error: "The persona has ended this conversation.", code: "conversation_ended" }, { status: 409 });
const unknownConversation = () =>
  Response.json({ error: "This conversation is no longer available.", code: "unknown_conversation" }, { status: 404 });
const outOfEnergy = () =>
  Response.json({ error: "You're out of energy. Ask the admin for more.", code: "out_of_energy" }, { status: 402 });
const turnInProgress = () =>
  Response.json({ error: "Still replying…", code: "turn_in_progress" }, { status: 409 });
const voiceUnavailable = () =>
  Response.json({ error: "Voice isn't available for this persona.", code: "voice_unavailable" }, { status: 400 });
const NOTHING_STORED: TurnContext = { history: [], acts: [], unanswered: false };

/**
 * One chat turn (spec §16.2, §18, §25.3). The server owns the history: it reads the last
 * messages and every act from the database, stores the visitor message (locking an ending)
 * before streaming, and stores the reply when the stream ends. Validates first, so rejections
 * get real HTTP statuses, then streams newline-delimited JSON, starting with the classifier's act.
 * The browser may leave mid-stream; the turn still runs to the end, so the reply is stored whole
 * and billed exactly (spec §26.4). There is no Stop. In a voice conversation the reply is also
 * spoken as it streams (spec §33.5).
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
  // Spec §26.4: a tester with no energy left is refused before any model call. The admin has no limit.
  const charge = user.role !== "admin";
  if (charge && user.energy.balance <= 0) return outOfEnergy();

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
  const { conversationId, personaId, text, retry, first, languageMode, mode, voiceLanguage: requestedLanguage } = parsed.value;

  let deps: ChatDeps;
  let persona: PersonaRow | null;
  let context: TurnContext;
  let existing: Awaited<ReturnType<typeof findConversation>>;
  try {
    deps = chatDeps();
    existing = await findConversation(deps.pool, conversationId);
    // Someone else's conversation, or one deleted since this tab opened it: only a first message creates one.
    if (existing ? existing.userId !== user.id : !first) return unknownConversation();
    if (existing && existing.personaSlug !== personaId) return invalid("This conversation is with another persona.");
    context = existing ? await loadTurnContext(deps.pool, conversationId) : NOTHING_STORED;
    // Spec §23: every ending is final, read from the server's own record, before any model call.
    if (existing?.turnRunning) return turnInProgress();
    if (existing?.ended || foldVisit(context.acts).closed) return conversationEnded();
    if (retry && !context.unanswered) {
      return Response.json({ error: "There's nothing to retry.", code: "nothing_to_retry" }, { status: 409 });
    }
    persona = await findPersona(deps.pool, personaId);
  } catch (err) {
    return unavailable(err, { showMessage: true });
  }
  // 2026-10-16: a hidden persona takes no new visits from testers; a visit already stored goes on, and the admin isn't blocked.
  const hiddenFromVisitor = persona?.hidden === true && context === NOTHING_STORED && user.role !== "admin";
  if (!persona || persona.status !== "ready" || hiddenFromVisitor) {
    return Response.json({ error: "This persona is no longer available.", code: "unknown_persona" }, { status: 404 });
  }

  // Spec §33.5: the first turn sets the mode and language; later turns use the stored ones, whatever the request says.
  const voiceLanguage = existing
    ? existing.mode === "voice" ? existing.voiceLanguage : null
    : mode === "voice" ? requestedLanguage! : null;
  let voice: StoredVoice | null = null;
  if (voiceLanguage) {
    try {
      voice = await findVoice(deps.pool, persona.slug);
    } catch (err) {
      return unavailable(err, { showMessage: true });
    }
    // Checked before any model call. A voice edited or deleted since the first turn doesn't stop the visit (spec §33.2).
    if (!existing && (voice?.status !== "approved" || !voiceLanguages(persona.languages).includes(voiceLanguage))) {
      return voiceUnavailable();
    }
  }

  // On Retry the visitor message is already stored, with its act: nothing is classified again.
  const visitorText = retry ? context.history.at(-1)!.text : text!;
  const before = retry ? context.history.slice(0, -1) : context.history;
  const previous = before.at(-1);
  // Spec §18.2: the classifier needs the profile, so it runs after findPersona, alongside getTools
  // and the languages backfill for personas stored without languages (spec §18.4).
  const ledger = new CostLedger();
  const [mcpTools, act, languages] = await Promise.all([
    deps.getTools(),
    retry
      ? Promise.resolve(context.acts.at(-1) ?? null)
      : deps.classifyVisitor({
          personaMessage: previous?.role === "persona" ? previous.text : null,
          visitorMessage: visitorText,
          profile: persona.profile,
          callbacks: [ledger.handler("classifier")],
        }),
    languagesFor(persona, deps),
  ]);
  const visit = foldVisit(retry ? context.acts : [...context.acts, act]);
  const history: HistoryMessage[] = [...before, { role: "user", text: visitorText }];

  const settleClassifier = () =>
    deps
      .resolveCosts(ledger.calls)
      .then((calls) => recordCalls(deps.pool, { userId: user.id, calls, charge }))
      .catch((err) => console.error(err));
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
      voice: voiceLanguage ? { language: voiceLanguage } : null,
    });
  } catch (err) {
    await settleClassifier();
    return unavailable(err, { showMessage: true });
  }
  if (!begun.ok) {
    // Spec §26.4: the classifier already ran; its cost is logged and charged even though the turn won't run.
    await settleClassifier();
    if (begun.reason === "busy") return turnInProgress();
    return begun.reason === "ended" ? conversationEnded() : unknownConversation();
  }

  const tools = mcpTools ? lockPersona(mcpTools, persona.slug, ledger) : [];
  const toolsAvailable = tools.length > 0;
  // languagesFor applies the English fallback (spec §18.4).
  const state = renderConversationState({ visit, languages, languageMode, voiceLanguage });
  const textEvents = chatEvents({
    personaId: persona.slug,
    ended: visit.ended ?? null,
    turn: runTurn({
      model: deps.model,
      tools,
      systemPrompt: buildPersonaPrompt(persona, { toolsAvailable, state, voice: voiceLanguage !== null }),
      messages: toAgentMessages(history),
      callbacks: [ledger.handler("agent")],
    }),
  });
  // Spec §26.4: a closed tab stops the sending, never the turn; in voice mode it also stops new speech calls (spec §33.5).
  const browser = { open: true };
  const events = voiceLanguage
    ? speakReply(textEvents, {
        voice: voice ? { baseVoice: voice.baseVoice, instructions: turnInstructions(voice, voiceLanguage, persona) } : null,
        speak: deps.speak,
        ledger,
        listening: () => browser.open,
      })
    : textEvents;

  const pool = deps.pool;
  const resolveCosts = deps.resolveCosts;
  const encoder = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      // Built from the same events the browser gets, so what's stored is what the visitor saw.
      let turn = startTurn("reply");
      // The agent runs on after a closed tab, so the reply is stored and billed whole.
      const send = (event: ChatStreamEvent) => {
        if (!browser.open) return;
        try {
          controller.enqueue(encoder.encode(`${JSON.stringify(event)}\n`));
        } catch {
          browser.open = false;
        }
      };
      try {
        send({ type: "act", act });
        if (!toolsAvailable) send({ type: "notice", code: "tools_unavailable" });
        for await (const event of events) {
          turn = applyChatEvent(turn, event);
          send(event);
        }
      } catch (err) {
        console.error(err); // chatEvents turns model errors into an error event; this is unexpected
      } finally {
        let calls: Awaited<ReturnType<typeof resolveCosts>> = [];
        try {
          const reply: Message | null = replyToStore(turn);
          calls = await resolveCosts(ledger.calls);
          const settled = await settleTurn(pool, { conversationId, userId: user.id, charge, reply, calls });
          // Spec §26.4: a tester learns only how much energy is left; the admin sees the spend.
          if (charge) send({ type: "energy", left: energyLeft(settled.balance ?? 0, settled.full ?? 0) });
          else send({ type: "cost", turn: settled.turn, conversation: settled.conversation });
        } catch (err) {
          console.error(err); // spec §26.7
          // The conversation may have been deleted mid-turn: the money was still spent, so log and charge without it.
          if (calls.length > 0) await recordCalls(pool, { userId: user.id, calls, charge }).catch((e) => console.error(e));
          // Don't leave the turn flag set for its 2-minute expiry; a deleted conversation updates 0 rows.
          await pool.query(`UPDATE conversations SET turn_running_since = NULL WHERE id = $1`, [conversationId]).catch((e) => console.error(e));
        }
        try {
          controller.close();
        } catch {
          // Already closed by a cancelled client.
        }
      }
    },
    cancel() {
      browser.open = false;
    },
  });
  return new Response(stream, { headers: { "Content-Type": "application/x-ndjson" } });
}
