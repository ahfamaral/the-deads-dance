import { describe, expect, it } from "vitest";
import { newId } from "@/lib/new-id";

const V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

describe("newId", () => {
  it("uses crypto.randomUUID when the browser has it", () => {
    const crypto = { randomUUID: () => "11111111-1111-4111-8111-111111111111", getRandomValues: globalThis.crypto.getRandomValues };
    expect(newId(crypto as unknown as Crypto)).toBe("11111111-1111-4111-8111-111111111111");
  });

  it("builds a v4 UUID from getRandomValues on plain HTTP, where randomUUID is missing", () => {
    const crypto = { getRandomValues: <T extends ArrayBufferView>(a: T) => globalThis.crypto.getRandomValues(a as never) as T };
    const ids = Array.from({ length: 50 }, () => newId(crypto as unknown as Crypto));
    for (const id of ids) expect(id).toMatch(V4);
    expect(new Set(ids).size).toBe(50);
  });
});
