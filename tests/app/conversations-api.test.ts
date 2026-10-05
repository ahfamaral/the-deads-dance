import { describe, expect, it, vi } from "vitest";
import { fetchConversation, fetchConversationList, removeConversation } from "@/lib/conversations-api";

const deps = (res: Response | Error) => ({
  fetch: vi.fn(async () => {
    if (res instanceof Error) throw res;
    return res;
  }),
  reload: vi.fn(),
});
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });

describe("conversations-api (spec §25.4)", () => {
  it("lists, or gives null on any failure", async () => {
    expect(await fetchConversationList(deps(json({ conversations: [] })))).toEqual([]);
    expect(await fetchConversationList(deps(json({}, 503)))).toBeNull();
    expect(await fetchConversationList(deps(new TypeError("offline")))).toBeNull();
  });

  it("tells found, missing (404) and failed apart", async () => {
    const conversation = { id: "c1", personaId: "wu", personaName: "Wu", updatedAt: "x", messages: [] };
    expect(await fetchConversation("c1", deps(json({ conversation })))).toEqual({ kind: "found", conversation });
    expect(await fetchConversation("c1", deps(json({}, 404)))).toEqual({ kind: "missing" });
    expect(await fetchConversation("c1", deps(json({}, 503)))).toEqual({ kind: "failed" });
  });

  it("treats a 200 with a non-JSON body (a captive portal) as a failure, not a rejection", async () => {
    const html = () => new Response("<html>", { status: 200, headers: { "Content-Type": "text/html" } });
    expect(await fetchConversationList(deps(html()))).toBeNull();
    expect(await fetchConversation("c1", deps(html()))).toEqual({ kind: "failed" });
  });

  it("counts a delete as done on 204, and on 404 (already gone)", async () => {
    expect(await removeConversation("c1", deps(new Response(null, { status: 204 })))).toBe(true);
    expect(await removeConversation("c1", deps(json({}, 404)))).toBe(true);
    expect(await removeConversation("c1", deps(json({}, 503)))).toBe(false);
  });

  // Review Focus 5: signed out or blocked: the page reloads to the sign-in screen.
  it("reloads the page on 401 or 403", async () => {
    for (const status of [401, 403]) {
      const d = deps(json({}, status));
      expect(await fetchConversationList(d)).toBeNull();
      expect(d.reload).toHaveBeenCalledOnce();
    }
  });
});
