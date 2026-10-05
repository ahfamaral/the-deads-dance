import { afterAll, describe, expect, it } from "vitest";
import { z } from "zod";
import { closePool } from "@corpus/db";
import { chatModel } from "@corpus/models";
import { applyChatEvent, startTurn } from "@/lib/turn-state";
import { HISTORY_WINDOW, type ChatStreamEvent, type LanguageMode, type Message } from "@/lib/chat-types";
import { readNdjson } from "@/lib/ndjson";
import { VisitorActSchema, type VisitorAct } from "@/lib/visitor-act";
import { closeMcpClient } from "@/lib/server/mcp-client";
import { loadDevEnv } from "./live-env";

// Opt-in (`npm run test:live`): the real route, MCP server, classifier and OpenRouter.
loadDevEnv();
const { POST } = await import("@/app/api/chat/route");
afterAll(async () => {
  await closeMcpClient();
  await closePool();
});

// The pre-2b request shape (spec §25): kept here so this parked live test still type-checks. It posts the old body and needs a rewrite at the costs discussion.
const MAX_ACTS = 500;
type ChatRequestMessage = { role: "user" | "persona"; text: string };

/**
 * The route gets text only; tool traces and sources stay in the browser. The server only
 * ever uses the last HISTORY_WINDOW messages (F1), so a long conversation is windowed here
 * too rather than rejected by the server's message-count cap.
 */
function toHistory(messages: Message[]): ChatRequestMessage[] {
  return messages.slice(-HISTORY_WINDOW).map(({ role, text }) => ({ role, text }));
}

/**
 * Spec §18.7: the acts of every user message except the newest, which the server
 * classifies itself. Messages saved before §18 have none and send null; so does a stored act
 * that no longer parses (an edited localStorage), so one bad entry never 400s the whole turn.
 */
function toActs(messages: Message[]): (VisitorAct | null)[] {
  const users = messages.filter((m) => m.role === "user");
  return users
    .slice(0, -1)
    .map((m) => {
      const parsed = VisitorActSchema.safeParse(m.act);
      return parsed.success ? parsed.data : null;
    })
    .slice(-MAX_ACTS);
}

type Sent = { status: number; events: ChatStreamEvent[]; body?: unknown };

async function send(body: object): Promise<Sent> {
  const res = await POST(
    new Request("http://localhost/api/chat", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }),
  );
  if (!res.ok) return { status: res.status, events: [], body: await res.json() };
  const events: ChatStreamEvent[] = [];
  for await (const e of readNdjson<ChatStreamEvent>(res.body!)) events.push(e);
  return { status: res.status, events };
}

/** Drives a conversation the way chat-session.tsx does: acts stored on user messages, sent back each turn. */
class Visit {
  messages: Message[] = [];
  constructor(
    readonly personaId: string,
    readonly languageMode: LanguageMode = "realistic",
  ) {}

  async say(text: string): Promise<{ sent: Sent; reply: Message | null }> {
    const history: Message[] = [...this.messages, { id: crypto.randomUUID(), role: "user", text }];
    const sent = await send({
      personaId: this.personaId,
      kind: "turn",
      messages: toHistory(history),
      acts: toActs(history),
      languageMode: this.languageMode,
    });
    if (sent.status !== 200) return { sent, reply: null };
    this.messages = history;
    return { sent, reply: this.finish(sent, history.length - 1) };
  }

  private finish(sent: Sent, userIndex: number): Message {
    let state = startTurn(crypto.randomUUID());
    for (const e of sent.events) state = applyChatEvent(state, e);
    if (state.status !== "done") throw new Error(`Turn failed: ${state.error?.reason}`);
    if (state.act !== undefined) this.messages[userIndex] = { ...this.messages[userIndex], act: state.act };
    this.messages = [...this.messages, state.message];
    console.log(`\n[${this.personaId}] → ${state.message.text}${state.message.ended ? `  (ended: ${state.message.ended})` : ""}\n`);
    return state.message;
  }
}

async function judge(question: string, text: string): Promise<boolean> {
  const model = chatModel("helper").withStructuredOutput(z.object({ answer: z.boolean() }), { name: "judgement" });
  const verdict = await model.invoke([
    { role: "user", content: `<reply>\n${text.replace(/[<>]/g, "")}\n</reply>\n\n${question} Answer true or false.` },
  ]);
  return verdict.answer;
}


describe("conversational behaviour (live)", () => {
  it("leaves after escalating insults and refuses the next turn", async () => {
    const visit = new Visit("chien-shiung-wu");
    const insults = [
      "Honestly, your work sounds overrated.",
      "You're a fraud who got lucky with other people's ideas.",
      "Women like you never belonged in a physics lab, you stupid fraud.",
    ];
    let ended: string | undefined;
    for (const line of insults) {
      const { reply } = await visit.say(line);
      ended = reply?.ended;
      if (ended) break;
    }
    expect(ended).toBe("offended");
    const after = await visit.say("Sorry, can we talk?");
    expect(after.sent.status).toBe(409);
  }, 300_000);

  it("says goodbye softly and still answers afterwards", async () => {
    const visit = new Visit("katherine-johnson");
    const { reply } = await visit.say("Bye, thank you!");
    expect(reply?.ended).toBe("farewell");
    const again = await visit.say("Oh, one more thing: what did you enjoy most about numbers?");
    expect(again.sent.status).toBe(200);
    expect(again.reply?.text.length).toBeGreaterThan(0);
  }, 240_000);

  it("answers a German visitor in German, searching in English", async () => {
    const visit = new Visit("albert-einstein");
    const { sent, reply } = await visit.say("Wo haben Sie studiert, und was hat Sie dort am meisten geprägt?");
    expect(await judge("Is this reply written in German?", reply!.text)).toBe(true);
    const queries = sent.events.flatMap((e) =>
      e.type === "tool_start" && typeof e.arguments.query === "string" ? [e.arguments.query] : [],
    );
    for (const q of queries) expect(await judge("Is this search query written in English?", q)).toBe(true);
  }, 240_000);

  it("doesn't understand a language it never spoke, in realistic mode", async () => {
    const { reply } = await new Visit("george-washington-carver").say("あなたはピーナッツで何を作りましたか？");
    const text = reply!.text;
    expect(await judge("Is this reply written in English?", text)).toBe(true);
    expect(await judge("Does this reply describe things made from peanuts?", text)).toBe(false);
  }, 240_000);

  it("answers in the visitor's language when the switch is on", async () => {
    const { reply } = await new Visit("george-washington-carver", "visitor").say("あなたはピーナッツで何を作りましたか？");
    expect(await judge("Is this reply written in Japanese?", reply!.text)).toBe(true);
  }, 240_000);

  it("reads a disagreement as a disagreement, not an insult", async () => {
    const visit = new Visit("albert-einstein");
    await visit.say("Your theory is wrong.");
    const act = visit.messages.find((m) => m.role === "user")?.act;
    expect(act).toMatchObject({ act: "disagreement", offense: 0 });
  }, 180_000);
});
