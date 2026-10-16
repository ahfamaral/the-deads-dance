import type { VoiceDto } from "@/lib/voice";

type Fetch = (url: string, init?: RequestInit) => Promise<Response>;
const defaultFetch: Fetch = (url, init) => window.fetch(url, init);

export type VoiceState = { voice: VoiceDto | null; voiceLanguages: string[] };
export type VoiceResult = { ok: true; voice: VoiceDto } | { ok: false; error: string; code?: string };

const url = (slug: string) => `/api/personas/${encodeURIComponent(slug)}/voice`;

async function send(slug: string, method: string, body: unknown, fetch: Fetch): Promise<VoiceResult> {
  try {
    const res = await fetch(url(slug), {
      method,
      headers: { "Content-Type": "application/json" },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const json: unknown = await res.json().catch(() => null);
    const data = (json && typeof json === "object" ? json : {}) as { voice?: VoiceDto; error?: string; code?: string };
    if (res.ok && data.voice) return { ok: true, voice: data.voice };
    return { ok: false, error: data.error ?? "Something went wrong. Try again.", code: data.code };
  } catch {
    return { ok: false, error: "Something went wrong. Try again." };
  }
}

/** Spec §33.3: the persona's voice (or null) and the languages a voice could serve; null when it couldn't be read. */
export async function fetchVoice(slug: string, fetch: Fetch = defaultFetch): Promise<VoiceState | null> {
  try {
    const res = await fetch(url(slug));
    if (!res.ok) return null;
    return (await res.json()) as VoiceState;
  } catch {
    return null;
  }
}

/** Drafts the voice and renders its first sample. Slow: the server makes a helper call and a speech call. */
export const createVoice = (slug: string, fetch: Fetch = defaultFetch) => send(slug, "POST", undefined, fetch);

export const saveVoice = (slug: string, patch: { baseVoice?: string; description?: string; render?: true }, fetch: Fetch = defaultFetch) =>
  send(slug, "PATCH", patch, fetch);

export const approveVoice = (slug: string, fetch: Fetch = defaultFetch) => send(slug, "PATCH", { status: "approved" }, fetch);

export async function removeVoice(slug: string, fetch: Fetch = defaultFetch): Promise<boolean> {
  try {
    return (await fetch(url(slug), { method: "DELETE" })).ok;
  } catch {
    return false;
  }
}

/** The sample's address; `updatedAt` changes with every new sample, so the browser never plays a stale one. */
export const sampleUrl = (slug: string, updatedAt: string) => `${url(slug)}/sample?v=${encodeURIComponent(updatedAt)}`;
