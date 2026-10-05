import type { ConversationSummary, StoredConversation } from "@/lib/conversation-types";

type Deps = { fetch: (url: string, init: RequestInit) => Promise<Response>; reload: () => void };

const browser: Deps = {
  fetch: (url, init) => window.fetch(url, init),
  reload: () => window.location.reload(),
};

/**
 * Spec §25.4, from the browser. null on a network failure. A 401 or 403 (signed out, blocked,
 * not approved) reloads the page, so it shows the right screen (spec §24.5).
 */
async function call(path: string, init: RequestInit, deps: Deps): Promise<Response | null> {
  let res: Response;
  try {
    res = await deps.fetch(path, { cache: "no-store", ...init });
  } catch {
    return null;
  }
  if (res.status === 401 || res.status === 403) {
    deps.reload();
    return null;
  }
  return res;
}

const path = (id: string) => `/api/conversations/${encodeURIComponent(id)}`;

/** The JSON body, or null when it isn't JSON (a captive portal answering 200 with a page). */
async function body(res: Response): Promise<Record<string, unknown> | null> {
  try {
    const parsed: unknown = await res.json();
    return parsed && typeof parsed === "object" ? (parsed as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

/** Your conversations, newest first, or null when they couldn't be loaded. */
export async function fetchConversationList(deps: Deps = browser): Promise<ConversationSummary[] | null> {
  const res = await call("/api/conversations", {}, deps);
  if (!res?.ok) return null;
  const list = (await body(res))?.conversations;
  return Array.isArray(list) ? (list as ConversationSummary[]) : null;
}

export type OpenResult = { kind: "found"; conversation: StoredConversation } | { kind: "missing" } | { kind: "failed" };

/** One conversation with its messages. "missing" is a 404: not yours, deleted, or never stored. */
export async function fetchConversation(id: string, deps: Deps = browser): Promise<OpenResult> {
  const res = await call(path(id), {}, deps);
  if (!res) return { kind: "failed" };
  if (res.ok) {
    const conversation = (await body(res))?.conversation;
    return conversation ? { kind: "found", conversation: conversation as StoredConversation } : { kind: "failed" };
  }
  return res.status === 404 ? { kind: "missing" } : { kind: "failed" };
}

/** True once it's gone: deleted now (204), or already (404). */
export async function removeConversation(id: string, deps: Deps = browser): Promise<boolean> {
  const res = await call(path(id), { method: "DELETE" }, deps);
  return res !== null && (res.status === 204 || res.status === 404);
}
