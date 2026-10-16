import { describe, expect, it } from "vitest";
import { createChunker } from "@/lib/server/speech-chunks";

describe("createChunker", () => {
  it("sends the first sentence alone, then groups up to ~300 characters", () => {
    const c = createChunker();
    expect(c.push("Well. ")).toEqual(["Well."]);
    const long = "A".repeat(150) + ". " + "B".repeat(150) + ". " + "C".repeat(20) + ". ";
    const out = c.push(long);
    expect(out).toEqual(["A".repeat(150) + "."]); // adding B would pass 300
    expect(c.flush()).toBe("B".repeat(150) + ". " + "C".repeat(20) + ".");
  });

  it("doesn't split on abbreviations", () => {
    const c = createChunker();
    expect(c.push("I went to St. Peter's school with Dr. Weber. Then")).toEqual([
      "I went to St. Peter's school with Dr. Weber.",
    ]);
  });

  it("keeps a trailing terminator pending until whitespace or flush", () => {
    const c = createChunker();
    expect(c.push("Hello.")).toEqual([]);
    expect(c.push(" Next")).toEqual(["Hello."]);
    expect(c.flush()).toBe("Next");
  });

  it("speaks text without an ending once, at flush", () => {
    const c = createChunker();
    expect(c.push("no punctuation at all")).toEqual([]);
    expect(c.flush()).toBe("no punctuation at all");
    expect(c.flush()).toBeNull();
  });

  it("never emits empty chunks", () => {
    const c = createChunker();
    expect(c.push("   ")).toEqual([]);
    expect(c.flush()).toBeNull();
  });

  it("loses and repeats nothing across token boundaries", () => {
    const text = "Ach, ja. Das Patentamt? Es war gut! Und dann… nun ja.";
    const c = createChunker();
    const parts: string[] = [];
    for (const ch of text) parts.push(...c.push(ch));
    const last = c.flush();
    if (last) parts.push(last);
    expect(parts.every((p) => p.length > 0 && p === p.trim())).toBe(true);
    expect(parts.join(" ").replace(/\s+/g, " ")).toBe(text);
  });

  it("cuts a sentence longer than the limit at a word boundary", () => {
    const input = Array.from({ length: 140 }, () => "word").join(" ").slice(0, 700).trimEnd();
    expect(input.length).toBeGreaterThan(600);
    const c = createChunker();
    const parts = [...c.push(input)];
    const last = c.flush();
    if (last) parts.push(last);
    expect(parts.length).toBeGreaterThan(2);
    for (const p of parts) expect(p.length).toBeLessThanOrEqual(300);
    expect(parts.join(" ")).toBe(input);
    // cuts fall on spaces, so every chunk is made of whole words
    for (const p of parts) expect(p.split(" ").every((w) => w === "word")).toBe(true);
  });

  it("cuts a long sentence that ends with a terminator", () => {
    const input = "x ".repeat(400).trim() + ". ";
    const c = createChunker();
    const parts = [...c.push(input)];
    const last = c.flush();
    if (last) parts.push(last);
    for (const p of parts) expect(p.length).toBeLessThanOrEqual(300);
    expect(parts.join(" ")).toBe(input.trim());
  });

  it("trims leading whitespace before the first sentence", () => {
    const c = createChunker();
    expect(c.push("\n  Well. ")).toEqual(["Well."]);
  });

  it("emits nothing for whitespace-only input longer than the limit", () => {
    const c = createChunker();
    expect(c.push(" \n".repeat(400))).toEqual([]);
    expect(c.flush()).toBeNull();
  });

  it("cuts at a newline or tab as well as a space", () => {
    const c = createChunker(10);
    expect(c.push("aaaa\nbbbb\tcccc")).toEqual(["aaaa\nbbbb"]);
    expect(c.flush()).toBe("cccc");
  });
});
