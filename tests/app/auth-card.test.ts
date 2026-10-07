import { describe, expect, it } from "vitest";
import { PRIVACY_NOTE } from "@/lib/auth-card";

describe("the sign-in privacy line (spec §27.4)", () => {
  it("tells testers the admin can read their conversations", () => {
    expect(PRIVACY_NOTE).toBe(
      "Your conversations are stored on our server, so you can see them on any device. The admin can read them to improve the app. Delete one from History at any time.",
    );
  });
});
