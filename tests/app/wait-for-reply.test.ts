import { describe, expect, it, vi } from "vitest";
import type { StoredConversation } from "@/lib/conversation-types";
import { waitForReply } from "@/lib/wait-for-reply";

const conv = (turnRunning: boolean): StoredConversation => ({ id: "c", personaId: "wu", personaName: "Wu", updatedAt: "", messages: [], mode: "text", voiceLanguage: null, turnRunning });

describe("waitForReply (spec §26.5)", () => {
  it("polls until the turn has finished", async () => {
    const fetchConversation = vi.fn()
      .mockResolvedValueOnce({ kind: "found", conversation: conv(true) })
      .mockResolvedValueOnce({ kind: "found", conversation: conv(false) });
    const sleep = vi.fn(async () => {});
    expect(await waitForReply("c", { fetchConversation, sleep })).toEqual(conv(false));
    expect(sleep).toHaveBeenCalledWith(3_000);
    expect(fetchConversation).toHaveBeenCalledTimes(2);
  });

  it("gives up when the conversation is gone, or after the time limit", async () => {
    expect(await waitForReply("c", { fetchConversation: async () => ({ kind: "missing" }), sleep: async () => {} })).toBeNull();
    const always = vi.fn(async () => ({ kind: "found" as const, conversation: conv(true) }));
    expect(await waitForReply("c", { fetchConversation: always, sleep: async () => {}, intervalMs: 1_000, maxMs: 3_000 })).toBeNull();
    expect(always).toHaveBeenCalledTimes(3);
  });

  it("stops when aborted", async () => {
    const controller = new AbortController();
    controller.abort();
    expect(await waitForReply("c", { fetchConversation: vi.fn(), sleep: async () => {}, signal: controller.signal })).toBeNull();
  });
});
