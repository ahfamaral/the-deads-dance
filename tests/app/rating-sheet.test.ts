import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import RatingSheet from "@/components/rating-sheet";
import type { Feedback } from "@/lib/feedback";

const noop = () => {};
const render = (initial: Feedback | null) =>
  renderToStaticMarkup(
    createElement(RatingSheet, { open: false, personaName: "Albert Einstein", initial, onSave: async () => null, onSaved: noop, onClose: noop }),
  );

describe("RatingSheet (spec §32.5)", () => {
  it("asks about the visit, with five labelled stars, a close button and an optional comment", () => {
    const html = render(null);
    expect(html).toContain("How was your visit with Albert Einstein?");
    for (const n of [1, 2, 3, 4, 5]) expect(html).toContain(`aria-label="${n} of 5 stars"`);
    expect(html).toContain('aria-label="Close"');
    expect(html).toContain('placeholder="Anything to add? (optional)"');
    expect(html).toMatch(/maxlength="2000"/i);
    expect(html).toContain(">Skip</button>");
  });

  it("keeps Send disabled until a star is picked", () => {
    expect(render(null)).toMatch(/<button[^>]*disabled=""[^>]*>Send<\/button>/);
  });

  it("opens pre-filled when editing, with Save", () => {
    const html = render({ stars: 4, comment: "Very kind" });
    expect(html).toMatch(/aria-label="4 of 5 stars"[^>]*checked=""|checked=""[^>]*aria-label="4 of 5 stars"/);
    expect(html).toContain("Very kind</textarea>");
    expect(html).toMatch(/<button(?![^>]*disabled="")[^>]*>Save<\/button>/);
  });
});
