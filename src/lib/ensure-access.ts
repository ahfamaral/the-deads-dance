import { parseMeter, type Meter } from "@/lib/meter";

type Deps = { fetch: (url: string, init: RequestInit) => Promise<Response>; reload: () => void };

const browser: Deps = {
  fetch: (url, init) => window.fetch(url, init),
  reload: () => window.location.reload(),
};

/**
 * Asks the server whether the user may still use the app, and reloads the page when they're
 * signed out (401, e.g. blocked) or not approved (403), so it shows the right screen.
 * Runs alongside the action, never in front of it: an outage or a network error leaves the
 * page alone, so the screen stays usable. Returns the screen's energy or spend (spec §26.5–6).
 */
export async function ensureAccess(deps: Deps = browser): Promise<Meter | null> {
  let res: Response;
  try {
    res = await deps.fetch("/api/access", { cache: "no-store" });
  } catch {
    return null;
  }
  if (res.status === 401 || res.status === 403) {
    deps.reload();
    return null;
  }
  if (!res.ok) return null;
  return parseMeter(await res.json().catch(() => null));
}
