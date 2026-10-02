import { afterEach, describe, expect, it, vi } from "vitest";
import { loadLanguageMode, saveLanguageMode } from "@/lib/language-mode";

function stubStorage(store: Record<string, string> = {}) {
  vi.stubGlobal("window", {
    localStorage: {
      getItem: (k: string) => store[k] ?? null,
      setItem: (k: string, v: string) => {
        store[k] = v;
      },
    },
  });
  return store;
}

afterEach(() => vi.unstubAllGlobals());

describe("language mode storage", () => {
  it("defaults to realistic and round-trips visitor", () => {
    stubStorage();
    expect(loadLanguageMode()).toBe("realistic");
    saveLanguageMode("visitor");
    expect(loadLanguageMode()).toBe("visitor");
  });

  it("ignores junk and survives storage that throws", () => {
    stubStorage({ "persona-chatbot:language-mode": "klingon" });
    expect(loadLanguageMode()).toBe("realistic");
    vi.stubGlobal("window", {
      localStorage: {
        getItem: () => {
          throw new Error("blocked");
        },
        setItem: () => {
          throw new Error("blocked");
        },
      },
    });
    expect(loadLanguageMode()).toBe("realistic");
    expect(() => saveLanguageMode("visitor")).not.toThrow();
  });
});
