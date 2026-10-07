import type { StoredConversation } from "@/lib/conversation-types";
import { fetchConversation as fetchFromApi } from "@/lib/conversations-api";

/**
 * Spec §26.5: the server is still writing a reply (the stream broke, or another tab sent a message).
 * Reads the conversation every 3 s until its turn has finished; null if it's gone or it takes too long.
 * The server's flag expires after 2 minutes, so 150 s always ends.
 */
export async function waitForReply(
  id: string,
  deps: {
    fetchConversation?: typeof fetchFromApi;
    sleep?: (ms: number) => Promise<void>;
    intervalMs?: number;
    maxMs?: number;
    signal?: AbortSignal;
  } = {},
): Promise<StoredConversation | null> {
  const get = deps.fetchConversation ?? fetchFromApi;
  const sleep = deps.sleep ?? ((ms) => new Promise<void>((resolve) => setTimeout(resolve, ms)));
  const interval = deps.intervalMs ?? 3_000;
  const max = deps.maxMs ?? 150_000;
  for (let waited = interval; waited <= max; waited += interval) {
    if (deps.signal?.aborted) return null;
    await sleep(interval);
    if (deps.signal?.aborted) return null;
    const result = await get(id);
    if (result.kind === "missing") return null;
    if (result.kind === "found" && !result.conversation.turnRunning) return result.conversation;
  }
  return null;
}
