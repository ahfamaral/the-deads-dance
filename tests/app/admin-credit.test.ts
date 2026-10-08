import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import AdminCredit from "@/components/admin-credit";

describe("AdminCredit's starting energy", () => {
  it("starts read-only, with a gear to change it and no input", () => {
    const html = renderToStaticMarkup(createElement(AdminCredit, { refresh: 0, onStartingEnergy: () => {} }));
    expect(html).toContain("Starting energy");
    expect(html).toContain('aria-label="Change starting energy"');
    expect(html).toContain('aria-pressed="false"');
    expect(html).not.toContain("<input");
    expect(html).not.toContain(`type="submit"`); // the closed confirm dialog is always in the page
  });
});
