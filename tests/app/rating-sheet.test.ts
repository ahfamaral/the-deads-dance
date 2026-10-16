import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import RatingSheet, { isBackdropClick, trySave } from "@/components/rating-sheet";
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

// Final review, Important 1: the close and save rules, without a DOM.
describe("isBackdropClick (spec §32.5)", () => {
  it("counts only a click on the dialog itself, not on its content", () => {
    const dialog = {} as EventTarget;
    const star = {} as EventTarget;
    expect(isBackdropClick(dialog, dialog)).toBe(true);
    expect(isBackdropClick(star, dialog)).toBe(false);
    expect(isBackdropClick(null, dialog)).toBe(false);
  });
});

describe("trySave (spec §32.5)", () => {
  it("saves the trimmed comment and returns what the server kept", async () => {
    const onSave = vi.fn(async () => ({ stars: 4, comment: "Good" }));
    expect(await trySave(onSave, 4, "  Good  ")).toEqual({ stars: 4, comment: "Good" });
    expect(onSave).toHaveBeenCalledWith({ stars: 4, comment: "Good" });
  });

  it("never calls onSave without a star or with an over-long comment", async () => {
    const onSave = vi.fn(async () => ({ stars: 4, comment: "" }));
    expect(await trySave(onSave, null, "")).toBeNull();
    expect(await trySave(onSave, 4, "x".repeat(2001))).toBeNull();
    expect(onSave).not.toHaveBeenCalled();
  });

  it("gives null when the save fails, so the sheet shows its error", async () => {
    expect(await trySave(async () => null, 3, "")).toBeNull();
  });
});
