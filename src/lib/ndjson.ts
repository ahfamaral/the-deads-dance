/** Parses a newline-delimited JSON stream, one value per line. */
export async function* readNdjson<T>(body: ReadableStream<Uint8Array>): AsyncGenerator<T> {
  // Not body.pipeThrough(new TextDecoderStream()): TypeScript 5.9's lib.dom.d.ts types
  // TextDecoderStream's writable side as WritableStream<BufferSource>, which isn't
  // assignable to the WritableStream<Uint8Array> that ReadableStream<Uint8Array>.pipeThrough
  // expects, so that call doesn't typecheck under --strict. Decoding by hand sidesteps it.
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  for (;;) {
    const { value, done } = await reader.read();
    if (done) {
      // Flushes any pending incomplete multi-byte sequence, matching TextDecoderStream's
      // own flush-on-close: a truncated trailing character becomes U+FFFD rather than
      // silently vanishing (which would otherwise lose the stream's final line entirely).
      buffer += decoder.decode();
      break;
    }
    buffer += decoder.decode(value, { stream: true });
    let newline: number;
    while ((newline = buffer.indexOf("\n")) >= 0) {
      const line = buffer.slice(0, newline).trim();
      buffer = buffer.slice(newline + 1);
      if (line) yield JSON.parse(line) as T;
    }
  }
  if (buffer.trim()) yield JSON.parse(buffer) as T;
}
