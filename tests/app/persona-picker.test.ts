import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import PersonaPicker from "@/components/persona-picker";
import type { Persona } from "@/lib/personas";

const persona = (id: string, name: string, hidden: boolean): Persona => ({ id, name, description: "", lifespan: "", origin: "curated", hidden });
const noop = () => {};
const render = (personas: Persona[], canManage = true) =>
  renderToStaticMarkup(
    createElement(PersonaPicker, {
      personas,
      canManage,
      notice: null,
      onConfirm: noop,
      onDelete: noop,
      onToggleHidden: noop,
      onAdd: noop,
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
