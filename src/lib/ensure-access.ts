type Deps = { fetch: (url: string, init: RequestInit) => Promise<Response>; reload: () => void };

const browser: Deps = {
  fetch: (url, init) => window.fetch(url, init),
  reload: () => window.location.reload(),
};

/**
 * Asks the server whether the user may still use the app, and reloads the page when they're
 * signed out (401, e.g. blocked) or not approved (403), so it shows the right screen.
 * Runs alongside the action, never in front of it: an outage or a network error leaves the
 * page alone, so local history stays usable.
 */
export async function ensureAccess(deps: Deps = browser): Promise<void> {
  let status: number;
  try {
    status = (await deps.fetch("/api/access", { cache: "no-store" })).status;
  } catch {
    return;
  }
  if (status === 401 || status === 403) deps.reload();
}
