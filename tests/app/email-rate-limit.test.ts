import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { closePool, getPool } from "@corpus/db";
import { checkAndRecordSend } from "@/lib/server/email-rate-limit";
import { resetAuth } from "../helpers/db";

beforeEach(() => resetAuth());
afterAll(() => closePool());

describe("checkAndRecordSend", () => {
  it("lets only one of several concurrent sends for one email through", async () => {
    // A race shows up only sometimes, so try a few rounds.
    for (let round = 0; round < 10; round++) {
      await resetAuth();
      const results = await Promise.all(Array.from({ length: 8 }, () => checkAndRecordSend(getPool(), "ana@example.com")));
      expect(results.filter(Boolean)).toHaveLength(1);
      const { rows } = await getPool().query(`SELECT count(*)::int AS n FROM otp_send_log`);
      expect(rows[0].n).toBe(1);
    }
  });

  it("doesn't hold back a different email", async () => {
    const [a, b] = await Promise.all([
      checkAndRecordSend(getPool(), "ana@example.com"),
      checkAndRecordSend(getPool(), "bo@example.com"),
    ]);
    expect([a, b]).toEqual([true, true]);
  });
});
