import { afterEach, describe, expect, it, vi } from "vitest";
import { ChatRequestError, streamChat } from "@/lib/chat-client";
import type { ChatStreamEvent } from "@/lib/chat-types";

afterEach(() => vi.unstubAllGlobals());

function ndjson(events: unknown[]): Response {
  return new Response(events.map((e) => `${JSON.stringify(e)}\n`).join(""), {
    headers: { "Content-Type": "application/x-ndjson" },
  });
}

async function collect(stream: AsyncIterable<ChatStreamEvent>): Promise<ChatStreamEvent[]> {
  const out: ChatStreamEvent[] = [];
  for await (const e of stream) out.push(e);
  return out;
}

describe("streamChat", () => {
  it("posts the conversation, the persona and the new text, then yields the streamed events", async () => {
    const fetchMock = vi.fn(async () => ndjson([{ type: "token", text: "Hi" }]));
    vi.stubGlobal("fetch", fetchMock);
    expect(await collect(streamChat({ conversationId: "c1", personaId: "wu", text: "Hi", first: true }))).toEqual([{ type: "token", text: "Hi" }]);
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("/api/chat");
    expect(JSON.parse(init.body as string)).toEqual({ conversationId: "c1", personaId: "wu", text: "Hi", first: true, languageMode: "realistic" });
  });

  // Review Focus 2: the server's reason reaches the user, and it isn't offered as retryable.
  it("throws a non-retryable error with the server's reason for a 4xx", async () => {
    vi.stubGlobal("fetch", async () =>
      Response.json({ error: "This persona is no longer available.", code: "unknown_persona" }, { status: 404 }),
    );
    await expect(collect(streamChat({ conversationId: "c1", personaId: "gone", text: "Hi" }))).rejects.toMatchObject({
      message: "This persona is no longer available.",
      retryable: false,
    });
  });

  it("throws a retryable error when the server can't be reached", async () => {
    vi.stubGlobal("fetch", async () => {
      throw new TypeError("fetch failed");
    });
    const error = await collect(streamChat({ conversationId: "c1", personaId: "wu", text: "Hi" })).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(ChatRequestError);
    expect(error).toMatchObject({ retryable: true, message: "Couldn't reach the server." });
  });

  it("throws a retryable error for a garbled stream", async () => {
    vi.stubGlobal("fetch", async () => new Response('{"type":"token","text":"Hi"}\n{not json\n'));
    await expect(collect(streamChat({ conversationId: "c1", personaId: "wu", text: "Hi" }))).rejects.toMatchObject({
      retryable: true,
      message: "The reply was interrupted.",
    });
  });
});

describe("streamChat: behaviour fields", () => {
  it("posts a Retry without text, and the language mode", async () => {
    const fetchMock = vi.fn(async () => ndjson([]));
    vi.stubGlobal("fetch", fetchMock);
    await collect(streamChat({ conversationId: "c1", personaId: "wu", retry: true, first: true, languageMode: "visitor" }));
    const [, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    // A retry never carries text or first: the server answers the stored message.
    expect(JSON.parse(init.body as string)).toEqual({ conversationId: "c1", personaId: "wu", retry: true, languageMode: "visitor" });
  });

  it("exposes the server's error code on a 409", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => Response.json({ error: "The persona has ended this conversation.", code: "conversation_ended" }, { status: 409 })),
    );
    await expect(streamChat({ conversationId: "c1", personaId: "wu", text: "Hi" }).next()).rejects.toMatchObject({
      code: "conversation_ended",
      retryable: false,
    });
    vi.unstubAllGlobals();
  });
});
