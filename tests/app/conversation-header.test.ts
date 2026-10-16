import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import Conversation from "@/components/conversation";

const html = (ownerEmail?: string) =>
  renderToStaticMarkup(
    createElement(Conversation, {
      personaName: "Wu",
      messages: [],
      onBack: () => {},
      languageMode: "realistic",
      onLanguageModeChange: () => {},
      ownerEmail,
    }),
  );

describe("Conversation header (spec §27)", () => {
  it("shows the owner's email under the persona's name when it's someone else's", () => {
    const out = html("ana@example.com");
    expect(out).toContain("ana@example.com");
    expect(out.indexOf("Wu")).toBeLessThan(out.indexOf("ana@example.com"));
  });
  it("shows no email line otherwise", () => {
    expect(html()).not.toContain("@");
  });
});

// 2026-10-16: a record from History can't be continued, so it has no language switch.
describe("the language switch (spec §18.4)", () => {
  const render = (live: boolean) =>
    renderToStaticMarkup(
      createElement(Conversation, {
        personaName: "Wu",
        messages: [],
        onBack: () => {},
        ...(live ? { languageMode: "realistic" as const, onLanguageModeChange: () => {} } : {}),
      }),
    );
  it("shows in a live conversation", () => {
    expect(render(true)).toContain("Always answer in my language");
  });
  it("is left out of a record from History", () => {
    expect(render(false)).not.toContain("Always answer in my language");
  });
});

// Spec §33.6: a record of a voice conversation is the normal transcript, marked above the messages.
describe("the voice marker (spec §33.6)", () => {
  const render = (voiceLanguage?: string) =>
    renderToStaticMarkup(
      createElement(Conversation, {
        personaName: "Wu",
        messages: [{ id: "m1", role: "user", text: "Hallo" }],
        onBack: () => {},
        voiceLanguage,
      }),
    );
  it("shows Voice conversation · Language above the messages", () => {
    const out = render("de");
    expect(out).toContain("Voice conversation · German");
    expect(out.indexOf("Voice conversation")).toBeLessThan(out.indexOf("Hallo"));
  });
  it("shows nothing for a text conversation", () => {
    expect(render()).not.toContain("Voice conversation");
  });
});
