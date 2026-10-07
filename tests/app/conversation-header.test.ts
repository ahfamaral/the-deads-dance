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
