import { describe, expect, it } from "vitest";
import { signInErrorMessage } from "@/lib/sign-in-errors";

describe("signInErrorMessage", () => {
  it("uses the spec's words for each failure", () => {
    expect(signInErrorMessage({ code: "INVALID_OTP" }, 2)).toBe("That code isn't right (2 tries left).");
    expect(signInErrorMessage({ code: "OTP_EXPIRED" })).toBe("That code expired: we can send a new one.");
    expect(signInErrorMessage({ code: "TOO_MANY_ATTEMPTS" })).toBe("Too many attempts: try again in a few minutes.");
    expect(signInErrorMessage({ status: 429 })).toBe("Too many attempts: try again in a few minutes.");
    expect(signInErrorMessage({ code: "EMAIL_RATE_LIMITED", status: 429 })).toBe("Too many attempts: try again in a few minutes.");
    expect(signInErrorMessage({ code: "EMAIL_SEND_FAILED" })).toBe("Couldn't send the code. Try again in a minute.");
    expect(signInErrorMessage({ code: "VERIFICATION_FAILED" })).toBe("Can't verify you right now. Try again in a minute.");
    expect(signInErrorMessage({ code: "MISSING_RESPONSE" })).toBe("Can't verify you right now. Try again in a minute.");
    expect(signInErrorMessage({ code: "UNKNOWN_ERROR", status: 500 })).toBe("Can't verify you right now. Try again in a minute.");
    expect(signInErrorMessage({ code: "BANNED_USER" })).toBe("Your account is blocked.");
    expect(signInErrorMessage(null)).toBe("Something went wrong. Try again.");
  });
});
