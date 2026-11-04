import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import PersonaPicker from "@/components/persona-picker";
import type { Persona } from "@/lib/personas";

const persona = (id: string, name: string, hidden: boolean, voiceLanguages: string[] = []): Persona => ({
  id, name, description: "", lifespan: "", origin: "curated", hidden, voiceLanguages, voiceStatus: null,
});
const noop = () => {};
const render = (personas: Persona[], canManage = true, voiceSupported?: boolean, initialConfiguring = false) =>
  renderToStaticMarkup(
    createElement(PersonaPicker, {
      personas,
      voiceSupported,
      initialConfiguring,
      canManage,
      notice: null,
      onConfirm: noop,
      onDelete: noop,
      onToggleHidden: noop, onEditVoice: noop,
      onBack: noop,
      meter: null,
      onDismissBanner: noop,
    }),
  );

// 2026-10-16: the admin hides a persona from testers' picker.
describe("PersonaPicker hide button", () => {
  it("offers Hide for a shown persona and Show for a hidden one, which is tagged", () => {
    const html = render([persona("wu", "Chien-Shiung Wu", false), persona("einstein", "Albert Einstein", true)]);
    expect(html).toContain('aria-label="Hide Chien-Shiung Wu"');
    expect(html).toContain('aria-label="Show Albert Einstein"');
    expect(html.match(/>Hidden</g)).toHaveLength(1);
  });

  it("puts the hide button before the trash button", () => {
    const html = render([persona("wu", "Chien-Shiung Wu", false)]);
    const hide = html.indexOf('aria-label="Hide Chien-Shiung Wu"');
    expect(hide).toBeGreaterThan(-1);
    expect(hide).toBeLessThan(html.indexOf("Chien-Shiung Wu is built in"));
  });

  it("has no hide button for someone who can't manage personas", () => {
    expect(render([persona("wu", "Chien-Shiung Wu", false)], false)).not.toContain('aria-label="Hide');
  });
});

// Spec §33.4: a small icon marks personas that can be talked to by voice.
describe("PersonaPicker voice icon", () => {
  it("shows the icon after the name when the voice is approved and speech is supported", () => {
    const html = render([persona("wu", "Chien-Shiung Wu", true, ["en"])], true, true);
    const icon = html.indexOf('aria-label="Voice available"');
    expect(icon).toBeGreaterThan(html.indexOf("Chien-Shiung Wu"));
    expect(icon).toBeLessThan(html.indexOf(">Hidden<"));
  });

  it("shows no icon without voice languages", () => {
    expect(render([persona("wu", "Chien-Shiung Wu", false)], true, true)).not.toContain("Voice available");
  });

  it("shows no icon where speech is not supported, and none in the server markup", () => {
    const wu = [persona("wu", "Chien-Shiung Wu", false, ["en"])];
    expect(render(wu, true, false)).not.toContain("Voice available");
    expect(render(wu)).not.toContain("Voice available");
  });
});

// Spec §34.7: configure mode links to the profile pages.
describe("PersonaPicker entry points (spec §34.7)", () => {
  const wu = [persona("chien-shiung-wu", "Chien-Shiung Wu", false)];
  it("links names to profiles and + to the new-persona page in configure mode", () => {
    const html = render(wu, true, false, true);
    expect(html).toContain('href="/admin/personas/chien-shiung-wu?from=manage"');
    expect(html).toContain('href="/admin/personas/new"');
    expect(html).toContain('aria-pressed="true"');
  });
  it("has neither link in normal mode, nor for a tester", () => {
    for (const html of [render(wu), render(wu, false, false, true)]) {
      expect(html).not.toContain("/admin/personas/chien-shiung-wu");
    }
    expect(render(wu, false, false, true)).not.toContain("/admin/personas/new");
    expect(render(wu, true, false, false)).not.toContain('href="/admin/personas/chien-shiung-wu');
  });
});
