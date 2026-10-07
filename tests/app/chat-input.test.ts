import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import ChatInput from "@/components/chat-input";

const html = (props: Partial<Parameters<typeof ChatInput>[0]> = {}) =>
  renderToStaticMarkup(createElement(ChatInput, { onSend: () => {}, busy: false, ...props }));

describe("ChatInput (spec §26.4–5)", () => {
  it("has no Stop button, even while a reply arrives", () => {
    expect(html({ busy: true })).not.toContain('aria-label="Stop"');
    expect(html({ busy: true })).toMatch(/aria-label="Send"[^>]*disabled/);
  });
  it("is disabled with the reason as placeholder when out of energy", () => {
    const out = html({ disabledReason: "Out of energy" });
    expect(out).toContain('placeholder="Out of energy"');
    expect(out).toMatch(/<textarea[^>]*disabled/);
  });
});
