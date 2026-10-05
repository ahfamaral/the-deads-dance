import { AIMessage, fakeModel, type BaseMessage } from "langchain";
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import { closePool, getPool } from "@corpus/db";
import type { ChatStreamEvent } from "@/lib/chat-types";
import { readNdjson } from "@/lib/ndjson";
import type { ChatDeps } from "@/lib/server/chat-deps";
import type { ClassifyVisitor } from "@/lib/server/visitor-classifier";
import type { VisitorAct } from "@/lib/visitor-act";
import { getAuth } from "@/lib/server/auth";
import { signInAs } from "../helpers/auth";
import { conversationRow, exchanges, messagesOf, seedConversation } from "../helpers/conversations";
import { insertPersona, resetAuth, resetDb } from "../helpers/db";
import { fakeMcpTool } from "../helpers/fake-mcp-tool";

const deps = vi.hoisted(() => ({ current: null as unknown }));
vi.mock("@/lib/server/chat-deps", () => ({
  chatDeps: () => {
    if (deps.current instanceof Error) throw deps.current;
    return deps.current;
  },
}));

const { POST } = await import("@/app/api/chat/route");

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
    expect(all.map((e) => e.type)).toEqual(["act", "tool_start", "tool_end", "token", "done"]);
    expect(all.at(-1)).toMatchObject({
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
    expect(all.at(-1)).toMatchObject({ type: "done" });
    expect(seen[0].text).toContain("tools are unavailable");
  });

  it("streams a retryable error when the model fails, and stores no reply", async () => {
    const quiet = vi.spyOn(console, "error").mockImplementation(() => {});
    setDeps({ model: fakeModel().respond(Object.assign(new Error("Too Many Requests"), { status: 429 })) });
    const all = await events(await post(first()));
    expect(all.at(-1)).toEqual({ type: "error", reason: expect.stringMatching(/rate-limited/), retryable: true });
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
    expect(all.at(-1)).toMatchObject({ type: "done", message: { text: "Good day.", ended: "offended" } });
    expect((await conversationRow(CONV)).ended).toBe("offended");
    expect((await messagesOf(CONV))[1].ended).toBe("offended");
    expect((await post(say("Sorry!"))).status).toBe(409);
  });

  /** Deps whose search tool presses Stop: the abort lands after the visitor message is stored. */
  function stopInTool(stop: AbortController, act: VisitorAct) {
    const search = fakeMcpTool("search_biography", () => (stop.abort(), { status: "ok", passages: [passage], queries: ["parity"] }));
    setDeps({ classifyVisitor: classifyFake(act), getTools: async () => [search.tool] });
  }

  it("locks the ending before the reply: Stop on the exit turn still ends the visit", async () => {
    const stop = new AbortController();
    stopInTool(stop, insult);
    await events(await post(first("You're a fraud."), { signal: stop.signal }));
    expect((await conversationRow(CONV)).ended).toBe("offended");
    expect((await messagesOf(CONV)).map((r) => r.role)).toEqual(["user"]);
    setDeps();
    expect((await post(say("Sorry!"))).status).toBe(409);
  });

  it("stores nothing for a Stop before any text, but keeps the visitor message and its act", async () => {
    const stop = new AbortController();
    stopInTool(stop, ACT);
    await events(await post(first("Tell me everything."), { signal: stop.signal }));
    const rows = await messagesOf(CONV);
    expect(rows.map((r) => [r.role, r.act])).toEqual([["user", ACT]]);
    expect((await conversationRow(CONV)).ended).toBeNull();
  });

  it("stores nothing at all for a Stop during classification (no null-act message escapes the ending rules)", async () => {
    const stop = new AbortController();
    setDeps({ classifyVisitor: vi.fn<ClassifyVisitor>(async () => (stop.abort(), null)) });
    await post(first("You're a fraud."), { signal: stop.signal });
    expect(await messagesOf(CONV)).toEqual([]);
    expect(await getPool().query("select 1 from conversations where id = $1", [CONV]).then((r) => r.rowCount)).toBe(0);
  });

  it("allows the wind-down turn and refuses the one after", async () => {
    await seedConversation({ id: CONV, userId, messages: exchanges(39, ACT) });
    setDeps({ model: fakeModel().respond(new AIMessage("I must rest now.")) });
    const lastAllowed = await post(say("One last question."));
    expect(lastAllowed.status).toBe(200);
    expect((await events(lastAllowed)).at(-1)).toMatchObject({ type: "done", message: { ended: "tired" } });
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
    expect(classify).toHaveBeenCalledWith({ personaMessage: "Hello.", visitorMessage: "Who are you?", profile: null, signal: expect.any(AbortSignal) });
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
    expect(all.at(-1)).toMatchObject({ type: "done" });
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
