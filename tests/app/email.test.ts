import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { sendApproval, sendCode } from "@/lib/server/email";

const fetchMock = vi.fn<typeof fetch>();

beforeEach(() => {
  fetchMock.mockReset();
  fetchMock.mockResolvedValue(new Response("{}", { status: 200 }));
  vi.stubGlobal("fetch", fetchMock);
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

const withResend = () => {
  vi.stubEnv("RESEND_API_KEY", "re_test");
  vi.stubEnv("EMAIL_FROM", "Dance <hi@example.com>");
};
const sentBody = () => JSON.parse(String(fetchMock.mock.calls[0][1]?.body));

describe("email (spec §24.7)", () => {
  it("prints to the console in dev when Resend isn't set, and sends nothing", async () => {
    vi.stubEnv("RESEND_API_KEY", "");
    const info = vi.spyOn(console, "info").mockImplementation(() => {});
    await sendCode("ana@example.com", "481562");
    expect(fetchMock).not.toHaveBeenCalled();
    expect(info.mock.calls[0][0]).toContain("ana@example.com");
    expect(info.mock.calls[0][0]).toContain("481562");
    info.mockRestore();
  });

  it("sends the code through Resend, with the key and sender", async () => {
    withResend();
    await sendCode("ana@example.com", "481562");
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("https://api.resend.com/emails");
    expect(init?.method).toBe("POST");
    expect((init?.headers as Record<string, string>).Authorization).toBe("Bearer re_test");
    expect(sentBody()).toMatchObject({ from: "Dance <hi@example.com>", to: "ana@example.com", subject: "Your sign-in code" });
    expect(sentBody().text).toContain("481562");
    expect(sentBody().html).toContain("481562");
  });

  it("sends the approval with a plain link to the site", async () => {
    withResend();
    await sendApproval("ana@example.com");
    expect(sentBody().to).toBe("ana@example.com");
    expect(sentBody().text).toContain("http://localhost:3000");
    expect(sentBody().html).toContain('href="http://localhost:3000"');
  });

  it("throws when Resend refuses, or can't be reached", async () => {
    withResend();
    fetchMock.mockResolvedValueOnce(new Response("{}", { status: 422 }));
    await expect(sendCode("ana@example.com", "481562")).rejects.toThrow(/422/);
    fetchMock.mockRejectedValueOnce(new TypeError("fetch failed"));
    await expect(sendApproval("ana@example.com")).rejects.toThrow(/fetch failed/);
  });
});
