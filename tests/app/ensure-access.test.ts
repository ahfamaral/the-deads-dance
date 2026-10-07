import { describe, expect, it, vi } from "vitest";
import { ensureAccess } from "@/lib/ensure-access";

const answering = (status: number) => vi.fn(async () => new Response(null, { status }));

describe("ensureAccess", () => {
  it.each([401, 403])("reloads the page on %i, so it shows sign-in or the status screen", async (status) => {
    const reload = vi.fn();
    const fetch = answering(status);
    await ensureAccess({ fetch, reload });
    expect(fetch).toHaveBeenCalledWith("/api/access", { cache: "no-store" });
    expect(reload).toHaveBeenCalledOnce();
  });

  it.each([200, 503])("leaves the page alone on %i", async (status) => {
    const reload = vi.fn();
    await ensureAccess({ fetch: answering(status), reload });
    expect(reload).not.toHaveBeenCalled();
  });

  it("leaves the page alone when the server can't be reached", async () => {
    const reload = vi.fn();
    await ensureAccess({ fetch: vi.fn(async () => Promise.reject(new TypeError("offline"))), reload });
    expect(reload).not.toHaveBeenCalled();
  });

  it("returns the screen's meter from a 200", async () => {
    const fetch = vi.fn(async () => Response.json({ energy: { left: 0.5, warningRead: 100 } }));
    expect(await ensureAccess({ fetch, reload: vi.fn() })).toEqual({ kind: "energy", left: 0.5, warningRead: 100 });
  });

  it("returns null after a reload, an outage or a network error", async () => {
    expect(await ensureAccess({ fetch: answering(401), reload: vi.fn() })).toBeNull();
    expect(await ensureAccess({ fetch: answering(503), reload: vi.fn() })).toBeNull();
    expect(await ensureAccess({ fetch: vi.fn(async () => Promise.reject(new TypeError("offline"))), reload: vi.fn() })).toBeNull();
  });
});
