import { describe, expect, it, vi } from "vitest";
import { requestHidden } from "@/lib/persona-hide-api";

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });

// 2026-10-16: the picker's hide button.
describe("requestHidden", () => {
  it("PATCHes the persona and returns the stored value", async () => {
    const fetch = vi.fn(async () => json({ hidden: true }));
    expect(await requestHidden("albert-einstein", true, fetch)).toBe(true);
    expect(fetch).toHaveBeenCalledWith(
      "/api/personas/albert-einstein",
      expect.objectContaining({ method: "PATCH", body: JSON.stringify({ hidden: true }) }),
    );
  });

  it("gives null on a refusal, a network failure or a body without hidden", async () => {
    expect(await requestHidden("x", true, async () => json({ error: "No such persona." }, 404))).toBeNull();
    expect(await requestHidden("x", true, async () => { throw new TypeError("offline"); })).toBeNull();
    expect(await requestHidden("x", true, async () => new Response("<html>", { status: 200 }))).toBeNull();
  });
});
