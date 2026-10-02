import { describe, expect, it } from "vitest";
import { readNdjson } from "@/lib/ndjson";

function streamOf(parts: string[]): ReadableStream<Uint8Array> {
  const encoder = new TextEncoder();
  return new ReadableStream({
    start(controller) {
      for (const part of parts) controller.enqueue(encoder.encode(part));
      controller.close();
    },
  });
}

async function collect(parts: string[]) {
  const out: unknown[] = [];
  for await (const item of readNdjson(streamOf(parts))) out.push(item);
  return out;
}

function streamOfBytes(chunks: Uint8Array[]): ReadableStream<Uint8Array> {
  return new ReadableStream({
    start(controller) {
      for (const chunk of chunks) controller.enqueue(chunk);
      controller.close();
    },
  });
}

async function collectBytes(chunks: Uint8Array[]) {
  const out: unknown[] = [];
  for await (const item of readNdjson(streamOfBytes(chunks))) out.push(item);
  return out;
}

describe("readNdjson", () => {
  it("yields one object per line, across chunk boundaries", async () => {
    expect(await collect(['{"a":1}\n{"b"', ':2}\n'])).toEqual([{ a: 1 }, { b: 2 }]);
  });

  it("handles a last line without a newline and skips blank lines", async () => {
    expect(await collect(['{"a":1}\n\n', '{"b":2}'])).toEqual([{ a: 1 }, { b: 2 }]);
  });

  it("decodes a multi-byte character split across chunks, with no trailing newline on the last line", async () => {
    // "É" (U+00C9) encodes as the two bytes 0xC3 0x89. Split the chunk boundary between
    // them, and leave off the final newline, so both the mid-stream split and the
    // no-trailing-newline final-buffer path are exercised together.
    const bytes = new TextEncoder().encode('{"name":"Émilie"}');
    const splitAt = bytes.indexOf(0xc3);
    const chunk1 = bytes.slice(0, splitAt + 1);
    const chunk2 = bytes.slice(splitAt + 1);
    expect(await collectBytes([chunk1, chunk2])).toEqual([{ name: "Émilie" }]);
  });

  it("surfaces an error instead of silently dropping a character truncated at the very end of the stream", async () => {
    // A real TextDecoderStream flushes its pending state when the stream closes, so a
    // dangling lead byte of a multi-byte sequence (0xC3 starts a 2-byte sequence, and no
    // continuation byte ever arrives) becomes U+FFFD rather than vanishing. That matches
    // this line: "{\"a\":1}\n" is consumed as a whole line (buffer empties), then the lone
    // 0xC3 is all that's left when the stream ends. Without a flush, decode({stream:true})
    // buffers it internally and returns "" for it, so the buffer is empty and nothing is
    // yielded for it at all — the truncation is silently dropped. With the flush, the
    // buffer becomes "�", which is not valid JSON on its own, so parsing throws —
    // surfacing the truncation as an error instead of silently losing it.
    const complete = new TextEncoder().encode('{"a":1}\n');
    const truncated = new Uint8Array([0xc3]);
    await expect(collectBytes([complete, truncated])).rejects.toThrow();
  });
});
