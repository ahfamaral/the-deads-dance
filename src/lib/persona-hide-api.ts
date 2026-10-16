type Fetch = (url: string, init: RequestInit) => Promise<Response>;

/**
 * 2026-10-16: hides a persona from testers' picker, or shows it again (admin). The stored value,
 * or null when it couldn't be changed.
 */
export async function requestHidden(slug: string, hidden: boolean, fetch: Fetch = (url, init) => window.fetch(url, init)): Promise<boolean | null> {
  try {
    const res = await fetch(`/api/personas/${encodeURIComponent(slug)}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ hidden }),
    });
    if (!res.ok) return null;
    const body: unknown = await res.json();
    const stored = body && typeof body === "object" ? (body as { hidden?: unknown }).hidden : undefined;
    return typeof stored === "boolean" ? stored : null;
  } catch {
    return null;
  }
}
