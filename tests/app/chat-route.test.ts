import { AIMessage, fakeModel, type BaseMessage } from "langchain";
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import { closePool, getPool } from "@corpus/db";
import type { ChatStreamEvent } from "@/lib/chat-types";
import { readNdjson } from "@/lib/ndjson";
import type { ChatDeps } from "@/lib/server/chat-deps";
import type { ClassifyVisitor } from "@/lib/server/visitor-classifier";
import type { VisitorAct } from "@/lib/visitor-act";
import { insertPersona, resetDb } from "../helpers/db";
import { fakeMcpTool } from "../helpers/fake-mcp-tool";

const deps = vi.hoisted(() => ({ current: null as unknown }));
vi.mock("@/lib/server/chat-deps", () => ({
  chatDeps: () => {
    if (deps.current instanceof Error) throw deps.current;
    return deps.current;
  },
}));

const { POST } = await import("@/app/api/chat/route");

const post = (body: unknown) =>
  POST(
    new Request("http://localhost/api/chat", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    }),
  );

const ask = (text = "What did your parity experiment show?") => ({
  personaId: "wu",
  messages: [{ role: "user", text }],
});

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

beforeEach(async () => {
  await resetDb();
  await insertPersona({ slug: "wu", displayName: "Chien-Shiung Wu" });
  setDeps();
});
afterAll(() => closePool());

describe("POST /api/chat", () => {
  it("streams the tool call, the answer, then the message with its sources", async () => {
    const search = setDeps();
    const res = await post(ask());
    expect(res.status).toBe(200);
    expect(res.headers.get("Content-Type")).toBe("application/x-ndjson");

    const all = await events(res);
    expect(all.map((e) => e.type)).toEqual(["act", "tool_start", "tool_end", "token", "done"]);
    expect(all[2]).toMatchObject({ type: "tool_end", status: "ok" });
    expect(all.at(-1)).toMatchObject({
      type: "done",
      message: {
        text: "I showed that parity is not conserved.",
        sources: [{ personaId: "wu", sectionHeading: "Parity experiment", chunkId: 7 }],
      },
    });
    expect(search.calls).toEqual([{ query: "parity", persona_id: "wu" }]);
  });

  it("gives the model the persona prompt and the history as chat roles", async () => {
    let seen: BaseMessage[] = [];
    setDeps({
      model: fakeModel().respond((messages: BaseMessage[]) => {
        seen = messages;
        return new AIMessage("Hello again.");
      }),
    });
    await events(
      await post({
        personaId: "wu",
        messages: [
          { role: "user", text: "Hi" },
          { role: "persona", text: "Hello." },
          { role: "user", text: "Who are you?" },
        ],
      }),
    );
    expect(seen[0].type).toBe("system");
    expect(seen[0].text).toContain("name: Chien-Shiung Wu");
    expect(seen.slice(1).map((m) => `${m.type}:${m.text}`)).toEqual(["human:Hi", "ai:Hello.", "human:Who are you?"]);
  });

  it("answers a turn whose history starts with the persona's greeting", async () => {
    let seen: BaseMessage[] = [];
    setDeps({
      model: fakeModel().respond((messages: BaseMessage[]) => {
        seen = messages;
        return new AIMessage("Good to meet you.");
      }),
    });
    const all = await events(
      await post({
        personaId: "wu",
        messages: [
          { role: "persona", text: "Welcome." },
          { role: "user", text: "Hi" },
        ],
      }),
    );
    expect(seen.slice(1).map((m) => `${m.type}:${m.text}`)).toEqual(["ai:Welcome.", "human:Hi"]);
    expect(all.at(-1)).toMatchObject({ type: "done" });
  });

  it("announces unavailable tools and still answers", async () => {
    let seen: BaseMessage[] = [];
    setDeps({
      getTools: async () => null,
      model: fakeModel().respond((messages: BaseMessage[]) => {
        seen = messages;
        return new AIMessage("I can't recall right now.");
      }),
    });
    const all = await events(await post(ask()));
    expect(all).toContainEqual({ type: "notice", code: "tools_unavailable" });
    expect(all.at(-1)).toMatchObject({ type: "done" });
    expect(seen[0].text).toContain("tools are unavailable");
  });

  it("streams a retryable error when the model fails", async () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    setDeps({ model: fakeModel().respond(Object.assign(new Error("Too Many Requests"), { status: 429 })) });
    const all = await events(await post(ask()));
    expect(all.at(-1)).toEqual({ type: "error", reason: expect.stringMatching(/rate-limited/), retryable: true });
    error.mockRestore();
  });

  // Review Focus 2: a persona deleted while its conversation is open.
  it.each([
    ["an unknown persona", "nobody"],
    ["a persona that isn't ready", "half"],
  ])("rejects %s with 404", async (_label, personaId) => {
    await insertPersona({ slug: "half", status: "ingesting" });
    const res = await post({ ...ask(), personaId });
    expect(res.status).toBe(404);
    expect(await res.json()).toMatchObject({ code: "unknown_persona", error: "This persona is no longer available." });
  });

  it("rejects an invalid request with 400 before streaming", async () => {
    const res = await post({ personaId: "wu", messages: [{ role: "user", text: "x".repeat(4001) }] });
    expect(res.status).toBe(400);
    expect((await res.json()).code).toBe("invalid_request");
  });

  it("rejects malformed JSON with 400 and a missing JSON content type with 415", async () => {
    const malformed = await POST(
      new Request("http://localhost/api/chat", { method: "POST", headers: { "Content-Type": "application/json" }, body: "{" }),
    );
    expect(malformed.status).toBe(400);
    const plain = await POST(new Request("http://localhost/api/chat", { method: "POST", body: "hi" }));
    expect(plain.status).toBe(415);
  });

  it("answers 503 when its dependencies can't be built", async () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    deps.current = new Error("OPENROUTER_API_KEY is not set. Add it to .env.");
    const res = await post(ask());
    expect(res.status).toBe(503);
    expect(await res.json()).toMatchObject({ code: "unavailable", error: expect.stringContaining("OPENROUTER_API_KEY") });
    error.mockRestore();
  });
});

describe("POST /api/chat: behaviour (spec §18)", () => {
  const insult: VisitorAct = { ...ACT, act: "insult", offense: 2 };

  it("classifies the newest message with the previous persona line and the profile", async () => {
    const classify = classifyFake();
    setDeps({ classifyVisitor: classify });
    await events(
      await post({
        personaId: "wu",
        messages: [
          { role: "user", text: "Hi" },
          { role: "persona", text: "Hello." },
          { role: "user", text: "Who are you?" },
        ],
      }),
    );
    expect(classify).toHaveBeenCalledWith({
      personaMessage: "Hello.",
      visitorMessage: "Who are you?",
      profile: null,
      signal: expect.any(AbortSignal),
    });
  });

  it("streams the act first and puts the state block in the prompt", async () => {
    let system = "";
    setDeps({
      classifyVisitor: classifyFake({ ...ACT, visitorName: "Maria" }),
      model: fakeModel().respond((messages: BaseMessage[]) => {
        system = messages[0].text;
        return new AIMessage("Maria. A good name.");
      }),
    });
    const all = await events(await post(ask("I'm Maria.")));
    expect(all[0]).toEqual({ type: "act", act: { ...ACT, visitorName: "Maria" } });
    expect(system).toContain("<conversation_state>\nThe visitor's name is Maria.");
  });

  // Spec §18.4 backfill: a persona added before languages existed must not read as English only.
  it("fetches and stores the languages of a persona stored without them", async () => {
    await insertPersona({ slug: "goulart", displayName: "João Goulart", origin: "user", wikidataQid: "Q34982" });
    let system = "";
    const fetchLanguages = vi.fn(async () => [{ code: "pt", name: "Portuguese", native: true }]);
    setDeps({
      fetchLanguages,
      classifyVisitor: classifyFake({ ...ACT, language: "pt" }),
      model: fakeModel().respond((messages: BaseMessage[]) => {
        system = messages[0].text;
        return new AIMessage("Boa tarde.");
      }),
    });
    await events(await post({ personaId: "goulart", messages: [{ role: "user", text: "Boa tarde, presidente." }] }));
    expect(fetchLanguages).toHaveBeenCalledWith("Q34982");
    expect(system).toContain("The visitor writes in Portuguese. You speak it, your native language; answer in Portuguese.");
    const { rows } = await getPool().query("SELECT languages FROM personas WHERE slug = 'goulart'");
    expect(rows[0].languages).toEqual([{ code: "pt", name: "Portuguese", native: true }]);
  });

  it("goes ahead in English when the languages lookup fails, and retries next turn", async () => {
    await insertPersona({ slug: "goulart", displayName: "João Goulart", origin: "user", wikidataQid: "Q34982" });
    const quiet = vi.spyOn(console, "error").mockImplementation(() => {});
    let system = "";
    setDeps({
      fetchLanguages: async () => {
        throw new Error("Wikidata down");
      },
      classifyVisitor: classifyFake({ ...ACT, language: "pt" }),
      model: fakeModel().respond((messages: BaseMessage[]) => {
        system = messages[0].text;
        return new AIMessage("Hm?");
      }),
    });
    const all = await events(await post({ personaId: "goulart", messages: [{ role: "user", text: "Olá." }] }));
    expect(all.at(-1)).toMatchObject({ type: "done" });
    expect(system).toContain("which you never learned");
    const { rows } = await getPool().query("SELECT languages FROM personas WHERE slug = 'goulart'");
    expect(rows[0].languages).toBeNull();
    quiet.mockRestore();
  });

  it("goes ahead without state when the classifier fails", async () => {
    let system = "";
    setDeps({
      classifyVisitor: classifyFake(null),
      model: fakeModel().respond((messages: BaseMessage[]) => {
        system = messages[0].text;
        return new AIMessage("Yes?");
      }),
    });
    const all = await events(await post(ask()));
    expect(all[0]).toEqual({ type: "act", act: null });
    expect(all.at(-1)).toMatchObject({ type: "done" });
    expect(system).not.toContain("<conversation_state>");
  });

  it("marks the reply that ends the visit in offense", async () => {
    setDeps({ classifyVisitor: classifyFake(insult), model: fakeModel().respond(new AIMessage("Good day.")) });
    // Spec §23.5: the first insult ends the visit.
    const all = await events(await post({ ...ask("You're a fraud."), acts: [ACT] }));
    expect(all.at(-1)).toMatchObject({ type: "done", message: { text: "Good day.", ended: "offended" } });
  });

  it("refuses a turn after the persona has left, without calling the model", async () => {
    const classify = classifyFake();
    setDeps({ classifyVisitor: classify });
    const res = await post({ ...ask("Sorry!"), acts: [insult, insult, insult] });
    expect(res.status).toBe(409);
    expect(await res.json()).toEqual({ error: "The persona has ended this conversation.", code: "conversation_ended" });
    expect(classify).not.toHaveBeenCalled();
  });

  it("refuses a turn after a farewell, without calling the model", async () => {
    const classify = classifyFake();
    setDeps({ classifyVisitor: classify });
    const farewell: VisitorAct = { ...ACT, act: "farewell" };
    const res = await post({ ...ask("One more thing!"), acts: [ACT, farewell] });
    expect(res.status).toBe(409);
    expect(await res.json()).toEqual({ error: "The persona has ended this conversation.", code: "conversation_ended" });
    expect(classify).not.toHaveBeenCalled();
  });

  it("refuses a turn after the wind-down turn, but allows the wind-down turn itself", async () => {
    const classify = classifyFake();
    setDeps({ classifyVisitor: classify, model: fakeModel().respond(new AIMessage("I must rest now.")) });
    const lastAllowed = await post({ ...ask(), acts: Array.from({ length: 39 }, () => ACT) });
    expect(lastAllowed.status).toBe(200);
    expect((await events(lastAllowed)).at(-1)).toMatchObject({ type: "done", message: { ended: "tired" } });

    const refused = await post({ ...ask(), acts: Array.from({ length: 40 }, () => ACT) });
    expect(refused.status).toBe(409);
  });

  // Spec §18.5 (revised 2026-09-29): the persona never speaks first.
  it("refuses an arrival request without calling the model", async () => {
    const classify = classifyFake();
    setDeps({ classifyVisitor: classify, model: fakeModel().respond(new AIMessage("Come in.")) });
    const res = await post({ personaId: "wu", kind: "arrival", messages: [] });
    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({ error: "Send at least one message." });
    expect(classify).not.toHaveBeenCalled();
  });

  it("passes the language mode through to the state block", async () => {
    let system = "";
    setDeps({
      classifyVisitor: classifyFake({ ...ACT, language: "ja" }),
      model: fakeModel().respond((messages: BaseMessage[]) => {
        system = messages[0].text;
        return new AIMessage("はい。");
      }),
    });
    await events(await post({ ...ask("こんにちは"), languageMode: "visitor" }));
    expect(system).toContain("Answer in Japanese, even though you never spoke it.");
  });
});
