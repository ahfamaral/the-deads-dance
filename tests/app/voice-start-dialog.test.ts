import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import VoiceStartDialog from "@/components/voice-start-dialog";
import type { Persona } from "@/lib/personas";

const persona: Persona = {
  id: "einstein",
  name: "Albert Einstein",
  description: "",
  lifespan: "",
  origin: "curated",
  hidden: false,
  voiceLanguages: ["de", "en"],
  voiceStatus: "approved",
};
const noop = () => {};
const html = (defaultLanguage = "en") =>
  renderToStaticMarkup(createElement(VoiceStartDialog, { persona, defaultLanguage, onStart: noop, onCancel: noop }));

describe("the start dialog (spec §33.4)", () => {
  it("carries the verbatim title, options and button", () => {
    const h = html();
    expect(h).toContain("How would you like to talk to Albert Einstein?");
    expect(h).toContain("Text");
    expect(h).toContain("As today");
    expect(h).toContain("Voice");
    expect(h).toContain("Each answer uses more energy");
    expect(h).toContain(">Start<");
  });

  it("has one pill per voice language, the default one pressed", () => {
    const h = html("en");
    expect(h).toMatch(/aria-pressed="false"[^>]*>German</);
    expect(h).toMatch(/aria-pressed="true"[^>]*>English</);
  });

  it("preselects Voice", () => {
    expect(html()).toMatch(/checked=""[^>]*value="voice"/);
  });
});
