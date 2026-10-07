import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import PersonaMessage from "@/components/persona-message";
import type { Message } from "@/lib/chat-types";
import { ENDED_NOTE, STOPPED_NOTE } from "@/lib/message-notes";

const html = (message: Message) => renderToStaticMarkup(createElement(PersonaMessage, { personaName: "Wu", message }));
const reply = (extra: Partial<Message> = {}): Message => ({ id: "m", role: "persona", text: "In 1956 I", ...extra });

describe("PersonaMessage", () => {
  it("marks a reply cut short by Stop", () => {
    expect(html(reply({ stopped: true }))).toContain(STOPPED_NOTE);
  });

  it("shows no stop note on a finished reply", () => {
    expect(html(reply())).not.toContain(STOPPED_NOTE);
  });

  it("puts the stop note before the ending note when both apply", () => {
    const out = html(reply({ stopped: true, ended: "farewell" }));
    expect(out.indexOf(STOPPED_NOTE)).toBeGreaterThan(-1);
    expect(out.indexOf(STOPPED_NOTE)).toBeLessThan(out.indexOf(ENDED_NOTE));
  });

  it("shows the admin the reply's cost line, after the notes", () => {
    const out = renderToStaticMarkup(createElement(PersonaMessage, { personaName: "Wu", message: reply({ ended: "farewell", cost: 9_000, tokens: 1_800 }), showCost: true }));
    expect(out).toContain("1.8k tok · $0.009");
    expect(out.indexOf(ENDED_NOTE)).toBeLessThan(out.indexOf("1.8k tok"));
  });

  it("never shows a cost line without showCost", () => {
    expect(html(reply({ cost: 9_000, tokens: 1_800 }))).not.toContain("tok");
  });
});
