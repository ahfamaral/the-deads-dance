import { describe, expect, it } from "vitest";
import { profileBackHref, profileHref } from "@/lib/profile-links";

const ID = "8f14e45f-ceea-467f-a0e6-2b8a2a6b1c11";

describe("profile links (spec §34.7)", () => {
  it("links from configure mode and from a conversation", () => {
    expect(profileHref("marie-curie", { kind: "manage" })).toBe("/admin/personas/marie-curie?from=manage");
    expect(profileHref("marie-curie", { kind: "open", conversationId: ID })).toBe(`/admin/personas/marie-curie?from=open:${ID}`);
  });

  it("round-trips back to where the admin came from", () => {
    const open = profileHref("a", { kind: "open", conversationId: ID });
    expect(profileBackHref(open.split("?")[1])).toBe(`/?open=${ID}`);
    expect(profileBackHref("?from=open:" + ID)).toBe(`/?open=${ID}`);
    expect(profileBackHref("from=manage")).toBe("/?manage=1");
  });

  it("falls back to configure mode for a missing or bad from", () => {
    expect(profileBackHref("")).toBe("/?manage=1");
    expect(profileBackHref("from=open:not-a-uuid")).toBe("/?manage=1");
    expect(profileBackHref("from=open:" + ID + "x")).toBe("/?manage=1");
    expect(profileBackHref("from=elsewhere")).toBe("/?manage=1");
  });

  it("encodes a slug", () => {
    expect(profileHref("a b", { kind: "manage" })).toBe("/admin/personas/a%20b?from=manage");
  });
});
