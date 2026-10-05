/**
 * A random v4 UUID, in the browser too. crypto.randomUUID exists only in secure contexts (HTTPS or
 * localhost), so a page opened over plain HTTP on a network address, such as a phone testing the dev
 * server, builds it from getRandomValues, which works everywhere.
 */
export function newId(crypto: Crypto = globalThis.crypto): string {
  if (typeof crypto.randomUUID === "function") return crypto.randomUUID();
  const b = crypto.getRandomValues(new Uint8Array(16));
  b[6] = (b[6] & 0x0f) | 0x40; // version 4
  b[8] = (b[8] & 0x3f) | 0x80; // RFC 4122 variant
  const hex = Array.from(b, (n) => n.toString(16).padStart(2, "0")).join("");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}
