/**
 * Spec §34.7: how the profile page knows where Back goes. The link carries where the admin came
 * from: the persona picker in configure mode, or an open conversation.
 */
export type ProfileFrom = { kind: "manage" } | { kind: "open"; conversationId: string };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function profileHref(slug: string, from: ProfileFrom): string {
  const value = from.kind === "manage" ? "manage" : `open:${from.conversationId}`;
  return `/admin/personas/${encodeURIComponent(slug)}?from=${value}`;
}

/** `search` is the URL's query string, with or without the "?". A missing or bad `from` is configure mode. */
export function profileBackHref(search: string): string {
  const from = new URLSearchParams(search).get("from") ?? "";
  const id = from.startsWith("open:") ? from.slice("open:".length) : "";
  return UUID.test(id) ? `/?open=${id}` : "/?manage=1";
}
