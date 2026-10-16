import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { FeedbackReportView } from "@/components/admin-feedback";
import type { FeedbackReport } from "@/lib/feedback";

// next/link needs the app router's context, which a static render doesn't have.
vi.mock("next/link", async () => {
  const { createElement } = await import("react");
  type Props = { href: string; children?: import("react").ReactNode };
  return { default: ({ href, children, ...rest }: Props) => createElement("a", { href, ...rest }, children) };
});

const ID = "8f14e45f-ceea-467f-a0e6-2b8a2a6b1c11";
const render = (report: FeedbackReport) => renderToStaticMarkup(createElement(FeedbackReportView, { report }));

describe("FeedbackReportView (spec §32.7)", () => {
  it("says so when there are no ratings", () => {
    expect(render({ summary: { count: 0, average: null, perPersona: [] }, items: [] })).toContain("No ratings yet.");
  });

  it("shows the summary, per persona, and each rating with a link to its conversation", () => {
    const html = render({
      summary: { count: 2, average: 3.5, perPersona: [{ personaName: "Marie Curie", count: 2, average: 3.5 }] },
      items: [
        { conversationId: ID, stars: 4, comment: "Lovely & kind", email: "ana@example.com", personaName: "Marie Curie", createdAt: "2026-10-16T10:00:00.000Z", edited: true },
        { conversationId: ID, stars: 3, comment: "", email: "bo@example.com", personaName: "Marie Curie", createdAt: "2026-10-15T10:00:00.000Z", edited: false },
      ],
    });
    expect(html).toContain("2 ratings · avg 3.5 ★");
    expect(html).toContain("Marie Curie");
    expect(html).toContain("★★★★☆");
    expect(html).toContain("Lovely &amp; kind");
    expect(html).toContain("ana@example.com");
    expect(html).toContain("edited");
    expect(html).toContain(`href="/?open=${ID}"`);
  });

  it("says 1 rating, not 1 ratings", () => {
    const html = render({
      summary: { count: 1, average: 5, perPersona: [{ personaName: "Wu", count: 1, average: 5 }] },
      items: [{ conversationId: ID, stars: 5, comment: "", email: "a@x.com", personaName: "Wu", createdAt: "2026-10-16T10:00:00.000Z", edited: false }],
    });
    expect(html).toContain("1 rating · avg 5.0 ★");
  });
});
