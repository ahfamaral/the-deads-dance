import { AIMessage, fakeModel, type BaseMessage } from "langchain";
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import { closePool, getPool } from "@corpus/db";
import type { ChatStreamEvent } from "@/lib/chat-types";
import { readNdjson } from "@/lib/ndjson";
import type { ChatDeps } from "@/lib/server/chat-deps";
import { approveVoice, deleteVoice, insertVoice, setSample } from "@/lib/server/persona-voices";
import type { Speak } from "@/lib/server/tts";
import type { ClassifyVisitor } from "@/lib/server/visitor-classifier";
import type { VisitorAct } from "@/lib/visitor-act";
import { getAuth } from "@/lib/server/auth";
import { signInAs } from "../helpers/auth";
import { conversationRow, exchanges, messagesOf, seedConversation } from "../helpers/conversations";
import { insertPersona, resetAuth, resetDb } from "../helpers/db";
import { giveEnergy } from "../helpers/energy";
import { fakeMcpTool } from "../helpers/fake-mcp-tool";

const deps = vi.hoisted(() => ({ current: null as unknown }));
vi.mock("@/lib/server/chat-deps", () => ({
  chatDeps: () => {
    if (deps.current instanceof Error) throw deps.current;
    return deps.current;
  },
}));

const { POST, maxDuration } = await import("@/app/api/chat/route");

async function events(res: Response): Promise<ChatStreamEvent[]> {
  const out: ChatStreamEvent[] = [];
  for await (const e of readNdjson<ChatStreamEvent>(res.body!)) out.push(e);
  return out;
}

const passage = { chunk_id: 7, section_heading: "Parity experiment", content: "Wu showed parity is violated." };
const searchCall = new AIMessage({
  content: "",
  tool_calls: [{ id: "t1", name: "search_biography", args: { query: "parity" }, type: "tool_call" }],
});

const ACT: VisitorAct = { act: "question", offense: 0, sorePoint: false, language: "en", wants: "normal", visitorName: null };
const classifyFake = (act: VisitorAct | null = ACT) => vi.fn<ClassifyVisitor>(async () => act);
const ttsCall = { role: "tts" as const, model: "google/gemini-3.8-flash-tts", inputTokens: 20, outputTokens: 64, cost: null, generationId: null, latencyMs: 1 };
const PCM = Buffer.alloc(4800);
const speakFake = () => vi.fn<Speak>(async () => ({ pcm: PCM, call: ttsCall }));

function setDeps(overrides: Partial<ChatDeps> = {}) {
  const search = fakeMcpTool("search_biography", () => ({ status: "ok", passages: [passage], queries: ["parity"] }));
  deps.current = {
    pool: getPool(),
    model: fakeModel().respond(searchCall).respond(new AIMessage("I showed that parity is not conserved.")),
    getTools: async () => [search.tool],
    classifyVisitor: classifyFake(),
    fetchLanguages: async () => {
      throw new Error("fetchLanguages should not be called");
    },
    resolveCosts: async (calls) =>
      calls.map((c) => ({ ...c, cost: c.cost ?? 0, costSource: c.cost === null ? ("estimated" as const) : ("reported" as const) })),
    speak: speakFake(),
    ...overrides,
  } satisfies ChatDeps;
  return search;
}

const CONV = "8f14e45f-ceea-467f-a0e6-2b8a2a6b1c11";
let cookie = "";
let userId = "";

const request = (body: unknown, init: RequestInit = {}) =>
  new Request("http://localhost/api/chat", {
    method: "POST",
    headers: { "Content-Type": "application/json", cookie },
    body: JSON.stringify(body),
    ...init,
  });
const post = (body: unknown, init?: RequestInit) => POST(request(body, init));

/** A new message in the conversation under test. */
const say = (text = "What did your parity experiment show?", extra: Record<string, unknown> = {}) => ({
  conversationId: CONV,
  personaId: "wu",
  text,
  ...extra,
});
/** The conversation's first message: nothing is stored yet. */
const first = (text?: string) => say(text, { first: true });
const ENDED = { error: "The persona has ended this conversation.", code: "conversation_ended" };
const human = (seen: BaseMessage[]) => seen.slice(1).map((m) => `${m.type}:${m.text}`);

beforeEach(async () => {
  await resetDb();
  await resetAuth();
  ({ cookie, userId } = await signInAs("tester@example.com", { status: "approved" }));
  await insertPersona({ slug: "wu", displayName: "Chien-Shiung Wu" });
  await giveEnergy(userId, 1_000_000);
  setDeps();
});
afterAll(() => closePool());

describe("POST /api/chat", () => {
  it("refuses an anonymous visitor with 401 before reading the body", async () => {
    const classify = classifyFake();
    setDeps({ classifyVisitor: classify });
    const res = await POST(new Request("http://localhost/api/chat", { method: "POST", body: "not json" }));
    expect(res.status).toBe(401);
    expect(await res.json()).toMatchObject({ code: "unauthenticated" });
    expect(classify).not.toHaveBeenCalled();
  });

  it("answers 503 unavailable when the session lookup fails (database down)", async () => {
    const spy = vi.spyOn(getAuth().api, "getSession").mockRejectedValueOnce(new Error("connect ECONNREFUSED 127.0.0.1:5433"));
    const quiet = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      const res = await post(first());
      expect(res.status).toBe(503);
      expect(await res.json()).toMatchObject({ code: "unavailable" });
    } finally {
      spy.mockRestore();
      quiet.mockRestore();
    }
  });

  it("refuses a pending user with 403", async () => {
    const pending = await signInAs("waiting@example.com", { status: "pending" });
    const res = await post(first(), { headers: { "Content-Type": "application/json", cookie: pending.cookie } });
    expect(res.status).toBe(403);
  });

  it("streams the tool call, the answer, then the message with its sources", async () => {
    const search = setDeps();
    const res = await post(first());
    expect(res.status).toBe(200);
    expect(res.headers.get("Content-Type")).toBe("application/x-ndjson");
    const all = await events(res);
    expect(all.map((e) => e.type)).toEqual(["act", "tool_start", "tool_end", "token", "done", "energy"]);
    expect(all.at(-2)).toMatchObject({
      type: "done",
      message: { text: "I showed that parity is not conserved.", sources: [{ personaId: "wu", sectionHeading: "Parity experiment", chunkId: 7 }] },
    });
    expect(search.calls).toEqual([{ query: "parity", persona_id: "wu" }]);
  });

  it("creates the conversation on its first message and stores both messages", async () => {
    await events(await post(first()));
    expect(await conversationRow(CONV)).toMatchObject({ user_id: userId, persona_slug: "wu", persona_name: "Chien-Shiung Wu", ended: null });
    const rows = await messagesOf(CONV);
    expect(rows.map((r) => [r.role, r.text])).toEqual([
      ["user", "What did your parity experiment show?"],
      ["persona", "I showed that parity is not conserved."],
    ]);
    expect(rows[0].act).toEqual(ACT);
    expect(rows[1]).toMatchObject({ stopped: false, ended: null, sources: [{ personaId: "wu", sectionHeading: "Parity experiment", chunkId: 7 }] });
    expect(rows[1].tool_calls).toHaveLength(1);
  });

  it("gives the model the persona prompt and the stored history, not the browser's", async () => {
    await seedConversation({ id: CONV, userId, messages: [{ role: "user", text: "Hi", act: ACT }, { role: "persona", text: "Hello." }] });
    let seen: BaseMessage[] = [];
    setDeps({ model: fakeModel().respond((m: BaseMessage[]) => ((seen = m), new AIMessage("I am Wu."))) });
    await events(await post(say("Who are you?")));
    expect(seen[0].type).toBe("system");
    expect(seen[0].text).toContain("name: Chien-Shiung Wu");
    expect(human(seen)).toEqual(["human:Hi", "ai:Hello.", "human:Who are you?"]);
  });

  it("sends the model only the last 20 messages of a long conversation", async () => {
    await seedConversation({ id: CONV, userId, messages: exchanges(15, ACT) });
    let seen: BaseMessage[] = [];
    setDeps({ model: fakeModel().respond((m: BaseMessage[]) => ((seen = m), new AIMessage("Yes."))) });
    await events(await post(say("And then?")));
    expect(human(seen)).toHaveLength(20);
    expect(human(seen).at(-1)).toBe("human:And then?");
  });

  it("announces unavailable tools and still answers", async () => {
    let seen: BaseMessage[] = [];
    setDeps({ getTools: async () => null, model: fakeModel().respond((m: BaseMessage[]) => ((seen = m), new AIMessage("I can't recall right now."))) });
    const all = await events(await post(first()));
    expect(all).toContainEqual({ type: "notice", code: "tools_unavailable" });
    expect(all.at(-2)).toMatchObject({ type: "done" });
    expect(seen[0].text).toContain("tools are unavailable");
  });

  it("streams a retryable error when the model fails, and stores no reply", async () => {
    const quiet = vi.spyOn(console, "error").mockImplementation(() => {});
    setDeps({ model: fakeModel().respond(Object.assign(new Error("Too Many Requests"), { status: 429 })) });
    const all = await events(await post(first()));
    expect(all.at(-2)).toEqual({ type: "error", reason: expect.stringMatching(/rate-limited/), retryable: true });
    expect((await messagesOf(CONV)).map((r) => r.role)).toEqual(["user"]);
    quiet.mockRestore();
  });

  // Review Focus 2: the reply streamed but couldn't be stored.
  it("still ends the stream with done when storing the reply fails", async () => {
    const quiet = vi.spyOn(console, "error").mockImplementation(() => {});
    const real = getPool();
    const failingStore = {
      query: (sql: string, params?: unknown[]) =>
        /INSERT INTO messages[\s\S]*'persona'/.test(sql) ? Promise.reject(new Error("connection lost")) : real.query(sql, params),
      connect: () => real.connect(),
    } as unknown as typeof real;
    setDeps({ pool: failingStore });
    const all = await events(await post(first()));
    expect(all.at(-1)).toMatchObject({ type: "done" });
    expect(quiet).toHaveBeenCalled();
    expect((await messagesOf(CONV)).map((r) => r.role)).toEqual(["user"]);
    quiet.mockRestore();
  });

  it.each([
    ["an unknown persona", "nobody"],
    ["a persona that isn't ready", "half"],
  ])("rejects %s with 404, storing nothing", async (_label, personaId) => {
    await insertPersona({ slug: "half", status: "ingesting" });
    const res = await post({ ...first(), personaId });
    expect(res.status).toBe(404);
    expect(await res.json()).toMatchObject({ code: "unknown_persona", error: "This persona is no longer available." });
    expect(await conversationRow(CONV)).toBeUndefined();
  });

  it.each([
    ["a message over 4,000 characters", { ...say("x".repeat(4001)), first: true }],
    ["the old history fields", { ...first(), messages: [{ role: "user", text: "Hi" }], acts: [] }],
    ["no text", { conversationId: CONV, personaId: "wu", first: true }],
    ["a malformed conversation id", { ...first(), conversationId: "not-a-uuid" }],
  ])("rejects %s with 400 before any model call", async (_label, body) => {
    const classify = classifyFake();
    setDeps({ classifyVisitor: classify });
    const res = await post(body);
    expect(res.status).toBe(400);
    expect((await res.json()).code).toBe("invalid_request");
    expect(classify).not.toHaveBeenCalled();
  });

  it("rejects malformed JSON with 400 and a missing JSON content type with 415", async () => {
    const malformed = await POST(new Request("http://localhost/api/chat", { method: "POST", headers: { "Content-Type": "application/json", cookie }, body: "{" }));
    expect(malformed.status).toBe(400);
    const plain = await POST(new Request("http://localhost/api/chat", { method: "POST", headers: { cookie }, body: "hi" }));
    expect(plain.status).toBe(415);
  });

  it("answers 503 when its dependencies can't be built", async () => {
    const quiet = vi.spyOn(console, "error").mockImplementation(() => {});
    deps.current = new Error("OPENROUTER_API_KEY is not set. Add it to .env.");
    const res = await post(first());
    expect(res.status).toBe(503);
    expect(await res.json()).toMatchObject({ code: "unavailable", error: expect.stringContaining("OPENROUTER_API_KEY") });
    quiet.mockRestore();
  });
});

describe("POST /api/chat: ownership (spec §25.3)", () => {
  it("answers 404 for another user's conversation, and stores nothing", async () => {
    const classify = classifyFake();
    setDeps({ classifyVisitor: classify });
    const other = await signInAs("other@example.com", { status: "approved" });
    await seedConversation({ id: CONV, userId: other.userId, messages: [{ role: "user", text: "Mine", act: ACT }, { role: "persona", text: "Yes." }] });
    for (const body of [say("Let me in"), first("Let me in")]) {
      const res = await post(body);
      expect(res.status).toBe(404);
      expect(await res.json()).toEqual({ error: "This conversation is no longer available.", code: "unknown_conversation" });
    }
    expect(await messagesOf(CONV)).toHaveLength(2);
    expect(classify).not.toHaveBeenCalled();
  });

  it.each([
    ["with another persona", { personaSlug: "curie" }],
    ["that has ended", { ended: "offended" as const }],
  ])("answers 404, not 400 or 409, for another user's conversation %s", async (_label, extra) => {
    const classify = classifyFake();
    setDeps({ classifyVisitor: classify });
    const other = await signInAs("other@example.com", { status: "approved" });
    await seedConversation({ id: CONV, userId: other.userId, ...extra, messages: [{ role: "user", text: "Mine", act: ACT }, { role: "persona", text: "Yes." }] });
    const res = await post(say("Let me in"));
    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ error: "This conversation is no longer available.", code: "unknown_conversation" });
    expect(classify).not.toHaveBeenCalled();
  });

  // Review Focus 3: deleted in another tab, continued in this one.
  it("answers 404 for a conversation that doesn't exist, unless it's the first message", async () => {
    const res = await post(say("Still there?"));
    expect(res.status).toBe(404);
    expect(await res.json()).toMatchObject({ code: "unknown_conversation" });
    expect(await conversationRow(CONV)).toBeUndefined();
  });

  it("rejects a different persona for the conversation with 400", async () => {
    await insertPersona({ slug: "curie", displayName: "Marie Curie" });
    await seedConversation({ id: CONV, userId, messages: [{ role: "user", text: "Hi", act: ACT }, { role: "persona", text: "Hello." }] });
    const res = await post({ ...say("Hi"), personaId: "curie" });
    expect(res.status).toBe(400);
  });
});

describe("POST /api/chat: endings, enforced by the server (spec §23, §25.3)", () => {
  const insult: VisitorAct = { ...ACT, act: "insult", offense: 2 };
  const farewell: VisitorAct = { ...ACT, act: "farewell" };

  it("refuses a turn after any stored ending, without calling the model", async () => {
    const classify = classifyFake();
    setDeps({ classifyVisitor: classify });
    for (const ending of ["farewell", "tired", "offended"] as const) {
      const id = crypto.randomUUID();
      await seedConversation({ id, userId, ended: ending, messages: [{ role: "user", text: "Bye", act: ACT }, { role: "persona", text: "Goodbye.", ended: ending }] });
      const res = await post({ conversationId: id, personaId: "wu", text: "One more thing!" });
      expect(res.status).toBe(409);
      expect(await res.json()).toEqual(ENDED);
    }
    expect(classify).not.toHaveBeenCalled();
  });

  it("refuses a turn when the stored acts already closed the visit, even with ended unset", async () => {
    await seedConversation({ id: CONV, userId, messages: [{ role: "user", text: "Bye", act: farewell }, { role: "persona", text: "Goodbye." }] });
    expect((await post(say("Wait!"))).status).toBe(409);
  });

  it("ends the visit on the first insult and refuses the next turn", async () => {
    setDeps({ classifyVisitor: classifyFake(insult), model: fakeModel().respond(new AIMessage("Good day.")) });
    const all = await events(await post(first("You're a fraud.")));
    expect(all.at(-2)).toMatchObject({ type: "done", message: { text: "Good day.", ended: "offended" } });
    expect((await conversationRow(CONV)).ended).toBe("offended");
    expect((await messagesOf(CONV))[1].ended).toBe("offended");
    expect((await post(say("Sorry!"))).status).toBe(409);
  });

  it("allows the wind-down turn and refuses the one after", async () => {
    await seedConversation({ id: CONV, userId, messages: exchanges(39, ACT) });
    setDeps({ model: fakeModel().respond(new AIMessage("I must rest now.")) });
    const lastAllowed = await post(say("One last question."));
    expect(lastAllowed.status).toBe(200);
    expect((await events(lastAllowed)).at(-2)).toMatchObject({ type: "done", message: { ended: "tired" } });
    expect((await conversationRow(CONV)).ended).toBe("tired");
    expect((await post(say("And another?"))).status).toBe(409);
  });
});

describe("POST /api/chat: Retry (spec §25.3)", () => {
  it("answers the unanswered visitor message again, without classifying or storing it twice", async () => {
    const maria = { ...ACT, visitorName: "Maria" };
    await seedConversation({ id: CONV, userId, messages: [{ role: "user", text: "Hi, I'm Maria.", act: maria }] });
    const classify = classifyFake();
    let seen: BaseMessage[] = [];
    setDeps({ classifyVisitor: classify, model: fakeModel().respond((m: BaseMessage[]) => ((seen = m), new AIMessage("Hello, Maria."))) });
    const all = await events(await post({ conversationId: CONV, personaId: "wu", retry: true }));
    expect(all[0]).toEqual({ type: "act", act: maria });
    expect(classify).not.toHaveBeenCalled();
    expect(human(seen)).toEqual(["human:Hi, I'm Maria."]);
    expect(seen[0].text).toContain("The visitor's name is Maria.");
    expect((await messagesOf(CONV)).map((r) => [r.role, r.text])).toEqual([
      ["user", "Hi, I'm Maria."],
      ["persona", "Hello, Maria."],
    ]);
  });

  it("refuses a Retry when the newest message already has a reply", async () => {
    await seedConversation({ id: CONV, userId, messages: [{ role: "user", text: "Hi", act: ACT }, { role: "persona", text: "Hello." }] });
    const res = await post({ conversationId: CONV, personaId: "wu", retry: true });
    expect(res.status).toBe(409);
    expect(await res.json()).toEqual({ error: "There's nothing to retry.", code: "nothing_to_retry" });
  });
});

describe("POST /api/chat: behaviour (spec §18)", () => {
  it("classifies the newest message with the previous stored persona line and the profile", async () => {
    await seedConversation({ id: CONV, userId, messages: [{ role: "user", text: "Hi", act: ACT }, { role: "persona", text: "Hello." }] });
    const classify = classifyFake();
    setDeps({ classifyVisitor: classify });
    await events(await post(say("Who are you?")));
    expect(classify).toHaveBeenCalledWith({ personaMessage: "Hello.", visitorMessage: "Who are you?", profile: null, callbacks: [expect.anything()] });
  });

  it("streams the act first and puts the state block in the prompt", async () => {
    let system = "";
    setDeps({
      classifyVisitor: classifyFake({ ...ACT, visitorName: "Maria" }),
      model: fakeModel().respond((m: BaseMessage[]) => ((system = m[0].text), new AIMessage("Maria. A good name."))),
    });
    const all = await events(await post(first("I'm Maria.")));
    expect(all[0]).toEqual({ type: "act", act: { ...ACT, visitorName: "Maria" } });
    expect(system).toContain("<conversation_state>\nThe visitor's name is Maria.");
  });

  it("fetches and stores the languages of a persona stored without them", async () => {
    await insertPersona({ slug: "goulart", displayName: "João Goulart", origin: "user", wikidataQid: "Q34982" });
    let system = "";
    const fetchLanguages = vi.fn(async () => [{ code: "pt", name: "Portuguese", native: true }]);
    setDeps({
      fetchLanguages,
      classifyVisitor: classifyFake({ ...ACT, language: "pt" }),
      model: fakeModel().respond((m: BaseMessage[]) => ((system = m[0].text), new AIMessage("Boa tarde."))),
    });
    await events(await post({ ...first("Boa tarde, presidente."), personaId: "goulart" }));
    expect(fetchLanguages).toHaveBeenCalledWith("Q34982");
    expect(system).toContain("The visitor writes in Portuguese. You speak it, your native language; answer in Portuguese.");
    const { rows } = await getPool().query("SELECT languages FROM personas WHERE slug = 'goulart'");
    expect(rows[0].languages).toEqual([{ code: "pt", name: "Portuguese", native: true }]);
  });

  it("goes ahead in English when the languages lookup fails", async () => {
    await insertPersona({ slug: "goulart", displayName: "João Goulart", origin: "user", wikidataQid: "Q34982" });
    const quiet = vi.spyOn(console, "error").mockImplementation(() => {});
    let system = "";
    setDeps({
      fetchLanguages: async () => {
        throw new Error("Wikidata down");
      },
      classifyVisitor: classifyFake({ ...ACT, language: "pt" }),
      model: fakeModel().respond((m: BaseMessage[]) => ((system = m[0].text), new AIMessage("Hm?"))),
    });
    const all = await events(await post({ ...first("Olá."), personaId: "goulart" }));
    expect(all.at(-2)).toMatchObject({ type: "done" });
    expect(system).toContain("which you never learned");
    quiet.mockRestore();
  });

  it("goes ahead without state when the classifier fails, storing a null act", async () => {
    let system = "";
    setDeps({ classifyVisitor: classifyFake(null), model: fakeModel().respond((m: BaseMessage[]) => ((system = m[0].text), new AIMessage("Yes?"))) });
    const all = await events(await post(first()));
    expect(all[0]).toEqual({ type: "act", act: null });
    expect(system).not.toContain("<conversation_state>");
    expect((await messagesOf(CONV))[0].act).toBeNull();
  });

  it("passes the language mode through to the state block", async () => {
    let system = "";
    setDeps({
      classifyVisitor: classifyFake({ ...ACT, language: "ja" }),
      model: fakeModel().respond((m: BaseMessage[]) => ((system = m[0].text), new AIMessage("はい。"))),
    });
    await events(await post({ ...first("こんにちは"), languageMode: "visitor" }));
    expect(system).toContain("Answer in Japanese, even though you never spoke it.");
  });
});

const billedReply = (text: string, cost: number) =>
  new AIMessage({ content: text, id: "gen-9", response_metadata: { usage: { cost } }, usage_metadata: { input_tokens: 900, output_tokens: 100, total_tokens: 1000 } });

describe("energy (spec §26.4)", () => {
  it("refuses a tester with no energy with 402, before any model call (Review Focus 1)", async () => {
    await giveEnergy(userId, 0, 0);
    const classify = classifyFake();
    setDeps({ classifyVisitor: classify });
    const res = await post(first());
    expect(res.status).toBe(402);
    expect(await res.json()).toMatchObject({ code: "out_of_energy" });
    expect(classify).not.toHaveBeenCalled();
  });

  it("refuses an overdrawn tester too", async () => {
    await giveEnergy(userId, -20_000, 1_000_000);
    expect((await post(first())).status).toBe(402);
  });

  it("charges the turn's real cost and sends the tester only a fraction, never money", async () => {
    setDeps({ model: fakeModel().respond(billedReply("Parity is violated.", 0.03)) });
    const out = await events(await post(first()));
    expect(out.at(-1)).toEqual({ type: "energy", left: 0.97 });
    expect(JSON.stringify(out)).not.toMatch(/"cost"|"tokens"|\$/);
    const { rows } = await getPool().query(`SELECT "energyBalance" FROM "user" WHERE id = $1`, [userId]);
    expect(Number(rows[0].energyBalance)).toBe(970_000);
    const stored = await getPool().query(`SELECT cost FROM messages WHERE role = 'persona' AND conversation_id = $1`, [CONV]);
    expect(Number(stored.rows[0].cost)).toBe(30_000);
  });

  it("never charges the admin, and sends the admin the turn's and the conversation's spend", async () => {
    ({ cookie, userId } = await signInAs("boss@example.com", { role: "admin" }));
    setDeps({ model: fakeModel().respond(billedReply("Hello.", 0.03)) });
    const out = await events(await post(first()));
    expect(out.at(-1)).toEqual({
      type: "cost",
      turn: { tokens: 1_000, cost: 30_000, inputTokens: 900, outputTokens: 100 },
      conversation: { tokens: 1_000, cost: 30_000 },
    });
  });

  it("refuses a second turn while one runs with 409 turn_in_progress (Review Focus 3)", async () => {
    await seedConversation({ id: CONV, userId, messages: [{ role: "user", text: "hi", act: ACT }] });
    await getPool().query(`UPDATE conversations SET turn_running_since = now() WHERE id = $1`, [CONV]);
    const res = await post(say());
    expect(res.status).toBe(409);
    expect(await res.json()).toMatchObject({ code: "turn_in_progress" });
  });

  it("finishes, stores and charges a turn after the browser disconnects (Review Focus 3)", async () => {
    setDeps({ model: fakeModel().respond(billedReply("Still here.", 0.01)) });
    const res = await post(first());
    const reader = res.body!.getReader();
    await reader.read(); // the act
    await reader.cancel(); // the tab closed
    for (let i = 0; i < 40; i++) {
      const { rows } = await getPool().query(`SELECT count(*)::int AS n FROM messages WHERE role = 'persona' AND conversation_id = $1`, [CONV]);
      if (rows[0].n === 1) break;
      await new Promise((r) => setTimeout(r, 50));
    }
    const { rows } = await getPool().query(
      `SELECT (SELECT text FROM messages WHERE role = 'persona' AND conversation_id = $2) AS text,
              (SELECT "energyBalance" FROM "user" WHERE id = $1) AS balance,
              (SELECT turn_running_since FROM conversations WHERE id = $2) AS running`,
      [userId, CONV],
    );
    expect(rows[0]).toEqual({ text: "Still here.", balance: "990000", running: null });
  });

  it("charges the classifier even when the turn then fails", async () => {
    const classify = vi.fn<ClassifyVisitor>(async (input) => {
      // Stands in for the real classifier recording its call through the handler it was given.
      const handler = input.callbacks?.[0] as unknown as { handleChatModelStart: (...a: unknown[]) => Promise<void>; handleLLMEnd: (...a: unknown[]) => Promise<void> };
      await handler.handleChatModelStart({}, [], "run-1", undefined, {}, [], { ls_model_name: "openai/gpt-5-mini" });
      await handler.handleLLMEnd({ generations: [[{ text: "", message: billedReply("", 0.0005) }]] }, "run-1");
      return ACT;
    });
    const failing = { invoke: () => { throw Object.assign(new Error("boom"), { status: 500 }); } };
    setDeps({ classifyVisitor: classify, model: failing as never });
    const quiet = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      await events(await post(first()));
    } finally {
      quiet.mockRestore();
    }
    const { rows } = await getPool().query(`SELECT "energyBalance" FROM "user" WHERE id = $1`, [userId]);
    expect(Number(rows[0].energyBalance)).toBe(999_500);
  });

  it("still charges and logs a turn whose conversation was deleted mid-turn", async () => {
    // Deterministic: the search tool deletes the conversation (awaited) between the agent's two model calls.
    const deleting = fakeMcpTool("search_biography", () => ({ status: "ok", passages: [passage], queries: ["parity"] }));
    const inner = deleting.tool;
    const tool = Object.assign(Object.create(Object.getPrototypeOf(inner)), inner, {
      invoke: async (...a: Parameters<typeof inner.invoke>) => {
        await getPool().query(`DELETE FROM conversations WHERE id = $1`, [CONV]);
        return inner.invoke(...a);
      },
    }) as typeof inner;
    const billedSearch = new AIMessage({
      content: "",
      id: "gen-8",
      tool_calls: [{ id: "t1", name: "search_biography", args: { query: "parity" }, type: "tool_call" }],
      response_metadata: { usage: { cost: 0.02 } },
      usage_metadata: { input_tokens: 90, output_tokens: 10, total_tokens: 100 },
    });
    setDeps({ getTools: async () => [tool], model: fakeModel().respond(billedSearch).respond(billedReply("Done.", 0.03)) });
    const quiet = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      await events(await post(first()));
    } finally {
      quiet.mockRestore();
    }
    const { rows } = await getPool().query(`SELECT "energyBalance" FROM "user" WHERE id = $1`, [userId]);
    expect(Number(rows[0].energyBalance)).toBe(950_000);
    const logged = await getPool().query(`SELECT count(*)::int AS n FROM model_calls WHERE user_id = $1 AND conversation_id IS NULL`, [userId]);
    expect(logged.rows[0].n).toBeGreaterThan(0);
  });
});

// Spec §31.4: twice Haiku's slowest measured answer, and within the 2-minute running-turn lock.
describe("chat route config", () => {
  it("allows 120 s per answer", () => {
    expect(maxDuration).toBe(120);
  });
});

// 2026-10-16: a hidden persona takes no new visits from testers; the admin and existing visits go on.
describe("POST /api/chat with a hidden persona", () => {
  const hideWu = () => getPool().query("UPDATE personas SET hidden = true WHERE slug = 'wu'");

  it("refuses a tester's new conversation with 404, storing nothing", async () => {
    await hideWu();
    const res = await post(first());
    expect(res.status).toBe(404);
    expect(await res.json()).toMatchObject({ code: "unknown_persona", error: "This persona is no longer available." });
    expect(await conversationRow(CONV)).toBeUndefined();
  });

  it("lets a tester's existing conversation continue", async () => {
    await seedConversation({ id: CONV, userId, personaSlug: "wu", messages: exchanges(1, ACT) });
    await hideWu();
    const res = await post(say());
    expect(res.status).toBe(200);
    await events(res);
    expect((await messagesOf(CONV)).length).toBe(4);
  });

  it("lets the admin start one", async () => {
    await resetAuth();
    ({ cookie, userId } = await signInAs("boss@example.com", { role: "admin" }));
    await hideWu();
    const res = await post(first());
    expect(res.status).toBe(200);
    await events(res);
    expect(await conversationRow(CONV)).toBeDefined();
  });
});

// Spec §33.5: a voice conversation speaks each reply as it streams.
describe("POST /api/chat: voice conversations", () => {
  const EINSTEIN_LANGUAGES = '[{"code":"de","name":"German","native":true},{"code":"en","name":"English","native":false}]';
  const REPLY = "Well. This is the rest of it.";

  async function addEinstein(approved = true) {
    await insertPersona({ slug: "einstein", displayName: "Albert Einstein" });
    await getPool().query(`UPDATE personas SET languages = $1::jsonb WHERE slug = 'einstein'`, [EINSTEIN_LANGUAGES]);
    await insertVoice(getPool(), { personaSlug: "einstein", baseVoice: "Algenib", description: "An old man, slow and warm.", sampleText: "Guten Tag." });
    if (approved) {
      await setSample(getPool(), "einstein", Buffer.alloc(10));
      await approveVoice(getPool(), "einstein");
    }
  }
  const talk = (extra: Record<string, unknown> = {}) => ({ conversationId: CONV, personaId: "einstein", text: "Hallo, Herr Professor.", ...extra });
  const firstVoice = (voiceLanguage = "de") => talk({ first: true, mode: "voice", voiceLanguage });
  const spoken = (all: ChatStreamEvent[]) => all.filter((e) => e.type === "audio");

  beforeEach(async () => {
    await addEinstein();
  });

  it("stores the mode and language on the first turn and speaks the reply in order", async () => {
    let system = "";
    const speak = speakFake();
    setDeps({ speak, model: fakeModel().respond((m: BaseMessage[]) => ((system = m[0].text), new AIMessage(REPLY))) });
    const all = await events(await post(firstVoice()));
    expect(await conversationRow(CONV)).toMatchObject({ mode: "voice", voice_language: "de" });
    expect(spoken(all)).toEqual([0, 1].map((seq) => ({ type: "audio", seq, data: PCM.toString("base64"), sampleRate: 24000 })));
    expect(all.find((e) => e.type === "done")).toMatchObject({ message: { text: REPLY } });
    expect(all.at(-1)).toMatchObject({ type: "energy" });
    expect(speak.mock.calls.map(([r]) => r.text)).toEqual(["Well.", "This is the rest of it."]);
    expect(speak.mock.calls[0][0]).toMatchObject({ voice: "Algenib", instructions: expect.stringContaining("An old man, slow and warm. Speaks German, the native language.") });
    expect(system).toContain("You are speaking aloud, not writing.");
    expect(system).toContain("You are speaking aloud in German; answer in German.");
    expect((await messagesOf(CONV)).map((r) => r.text)).toEqual(["Hallo, Herr Professor.", REPLY]);
  });

  it("refuses a voice conversation with a persona whose voice isn't approved, before any model call", async () => {
    await insertPersona({ slug: "curie", displayName: "Marie Curie" });
    await getPool().query(`UPDATE personas SET languages = $1::jsonb WHERE slug = 'curie'`, [EINSTEIN_LANGUAGES]);
    await insertVoice(getPool(), { personaSlug: "curie", baseVoice: "Kore", description: "A precise woman.", sampleText: "Bonjour." });
    const classify = classifyFake();
    setDeps({ classifyVisitor: classify });
    for (const personaId of ["curie", "wu"]) {
      const res = await post({ ...firstVoice(), personaId });
      expect(res.status).toBe(400);
      expect(await res.json()).toEqual({ error: "Voice isn't available for this persona.", code: "voice_unavailable" });
    }
    expect(classify).not.toHaveBeenCalled();
    expect(await conversationRow(CONV)).toBeUndefined();
  });

  it("refuses a language the persona's voice can't speak", async () => {
    const res = await post(firstVoice("fr"));
    expect(res.status).toBe(400);
    expect((await res.json()).code).toBe("voice_unavailable");
  });

  it("refuses voice mode without a language", async () => {
    const res = await post(talk({ first: true, mode: "voice" }));
    expect(res.status).toBe(400);
    expect((await res.json()).code).toBe("invalid_request");
  });

  // Review Focus 3: a stale tab or crafted request can't switch the mode or language after the first turn.
  it("keeps the stored mode and language on later turns", async () => {
    setDeps({ model: fakeModel().respond(new AIMessage(REPLY)) });
    await events(await post(firstVoice()));
    let system = "";
    setDeps({ model: fakeModel().respond((m: BaseMessage[]) => ((system = m[0].text), new AIMessage(REPLY))) });
    const later = await events(await post(talk({ mode: "text" })));
    expect(spoken(later)).toHaveLength(2);
    expect(system).toContain("You are speaking aloud in German");

    const textConv = crypto.randomUUID();
    setDeps({ model: fakeModel().respond(new AIMessage(REPLY)) });
    await events(await post({ ...talk(), conversationId: textConv, first: true }));
    setDeps({ model: fakeModel().respond(new AIMessage(REPLY)) });
    const crafted = await events(await post({ ...talk({ mode: "voice", voiceLanguage: "de" }), conversationId: textConv }));
    expect(crafted.some((e) => e.type === "audio" || e.type === "audio_error")).toBe(false);
    expect(await conversationRow(textConv)).toMatchObject({ mode: "text", voice_language: null });
  });

  it("logs each speech call as a tts row and charges it to the tester", async () => {
    setDeps({
      model: fakeModel().respond(new AIMessage(REPLY)),
      resolveCosts: async (calls) => calls.map((c) => ({ ...c, cost: c.role === "tts" ? 5_000 : 0, costSource: "estimated" as const })),
    });
    await events(await post(firstVoice()));
    const { rows } = await getPool().query(`SELECT user_id, conversation_id FROM model_calls WHERE role = 'tts'`);
    expect(rows).toEqual([0, 1].map(() => ({ user_id: userId, conversation_id: CONV })));
    const balance = await getPool().query(`SELECT "energyBalance" FROM "user" WHERE id = $1`, [userId]);
    expect(Number(balance.rows[0].energyBalance)).toBe(990_000);
  });

  // Review Focus 1: the voice was deleted mid-visit; the turn still answers, in text.
  it("streams the text and an audio_error when the voice was deleted since the first turn", async () => {
    setDeps({ model: fakeModel().respond(new AIMessage(REPLY)) });
    await events(await post(firstVoice()));
    await deleteVoice(getPool(), "einstein");
    const speak = speakFake();
    setDeps({ speak, model: fakeModel().respond(new AIMessage(REPLY)) });
    const res = await post(talk());
    expect(res.status).toBe(200);
    const all = await events(res);
    expect(all.map((e) => e.type)).toEqual(["act", "token", "done", "audio_error", "energy"]);
    expect(speak).not.toHaveBeenCalled();
    expect((await messagesOf(CONV)).map((r) => r.role)).toEqual(["user", "persona", "user", "persona"]);
  });

  // Review Focus 4: the tab closed mid-answer.
  it("still stores the reply when the browser goes away after the first audio", async () => {
    setDeps({ model: fakeModel().respond(new AIMessage(REPLY)) });
    const res = await post(firstVoice());
    const reader = res.body!.getReader();
    const decoder = new TextDecoder();
    let seen = "";
    while (!seen.includes('"type":"audio"')) {
      const { value, done } = await reader.read();
      if (done) break;
      seen += decoder.decode(value);
    }
    await reader.cancel();
    await vi.waitFor(async () => {
      const { rows } = await getPool().query(`SELECT turn_running_since FROM conversations WHERE id = $1`, [CONV]);
      expect(rows[0].turn_running_since).toBeNull();
    });
    expect((await messagesOf(CONV)).map((r) => r.text)).toEqual(["Hallo, Herr Professor.", REPLY]);
  });
});
