import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { closePool, getPool } from "@corpus/db";
import { parseStatus, requireAdmin, requireApproved } from "@/lib/server/access";
import { blockUser } from "@/lib/server/users";
import { resetAuth } from "../helpers/db";
import { signInAs } from "../helpers/auth";

const req = (cookie?: string) => new Request("http://localhost/x", { headers: cookie ? { cookie } : {} });
const status = async (r: unknown) => (r instanceof Response ? r.status : 200);

beforeEach(() => resetAuth());
afterAll(() => closePool());

describe("guards", () => {
  it("requireApproved: 401 anonymous, 403 for pending/rejected/blocked, the user when approved or admin", async () => {
    expect(await status(await requireApproved(req()))).toBe(401);
    // "blocked" with a live session: block deletes sessions, but the status alone must still refuse.
    for (const s of ["pending", "rejected", "blocked"] as const) {
      const { cookie } = await signInAs(`${s}@example.com`, { status: s });
      const r = await requireApproved(req(cookie));
      expect(await status(r)).toBe(403);
      expect(await (r as Response).json()).toMatchObject({ code: "not_approved" });
    }
    const ok = await signInAs("ok@example.com", { status: "approved" });
    expect(await requireApproved(req(ok.cookie))).toMatchObject({ email: "ok@example.com", status: "approved" });
    const boss = await signInAs("boss@example.com", { role: "admin" });
    expect(await requireApproved(req(boss.cookie))).toMatchObject({ role: "admin" });
  });

  it("requireAdmin answers 404 to everyone but the admin", async () => {
    expect(await status(await requireAdmin(req()))).toBe(404);
    const ok = await signInAs("ok@example.com", { status: "approved" });
    expect(await status(await requireAdmin(req(ok.cookie)))).toBe(404);
    const boss = await signInAs("boss@example.com", { role: "admin" });
    expect(await requireAdmin(req(boss.cookie))).toMatchObject({ role: "admin" });
  });

  it("a blocked user's old cookie no longer works", async () => {
    const boss = await signInAs("boss@example.com", { role: "admin" });
    const ana = await signInAs("ana@example.com", { status: "approved" });
    await blockUser(getPool(), ana.userId, boss.userId);
    expect(await status(await requireApproved(req(ana.cookie)))).toBe(401);
  });
});

describe("parseStatus", () => {
  it("keeps the four known statuses, reads a missing one as pending, and anything else as rejected", () => {
    for (const s of ["pending", "approved", "rejected", "blocked"]) expect(parseStatus(s)).toBe(s);
    expect(parseStatus(undefined)).toBe("pending");
    expect(parseStatus(null)).toBe("pending");
    for (const s of ["Approved", "admin", "", 1, {}]) expect(parseStatus(s)).toBe("rejected");
  });
});
