import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import FeedbackRow from "@/components/feedback-row";
import type { Feedback } from "@/lib/feedback";

const render = (feedback: Feedback | null, editable: boolean) =>
  renderToStaticMarkup(createElement(FeedbackRow, { feedback, editable, onRate: () => {} }));

describe("FeedbackRow (spec §32.6)", () => {
  it("offers to rate your unrated record", () => {
    expect(render(null, true)).toContain(">Rate this conversation</button>");
  });

  it("shows your rating with Edit", () => {
    const html = render({ stars: 4, comment: "Nice" }, true);
    expect(html).toContain("Your rating:");
    expect(html).toContain("★★★★☆");
    expect(html).toContain("4 of 5 stars");
    expect(html).toContain(">Edit</button>");
  });

  // Review Focus 4: the admin on someone else's record reads, never edits.
  it("shows the owner's stars and comment read-only to the admin", () => {
    const html = render({ stars: 2, comment: "Too long" }, false);
    expect(html).toContain("Their rating:");
    expect(html).toContain("Too long");
    expect(html).not.toContain("<button");
  });

  it("shows nothing for someone else's unrated record", () => {
    expect(render(null, false)).toBe("");
  });
});
