import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import EnergyBar from "@/components/energy-bar";
import EnergyNotice from "@/components/energy-notice";
import SpendBadge from "@/components/spend-badge";

const bar = (left: number) => renderToStaticMarkup(createElement(EnergyBar, { left }));

describe("EnergyBar (spec §26.5)", () => {
  it("is a meter labelled with what's left", () => {
    const html = bar(0.18);
    expect(html).toContain('role="meter"');
    expect(html).toContain('aria-label="Energy: 18% left"');
  });
  it("colours by level", () => {
    expect(bar(0.7)).toContain("bg-green-500");
    expect(bar(0.45)).toContain("bg-yellow-400");
    expect(bar(0.18)).toContain("bg-red-500");
    expect(bar(0.06)).toContain("bg-red-800");
    expect(bar(0)).toContain("text-neutral-200");
  });
  it("pulses slowly under 20%, fast under 10%, never when still or empty, and not with reduced motion", () => {
    expect(bar(0.7)).not.toContain("energy-pulse");
    expect(bar(0.45)).not.toContain("energy-pulse");
    expect(bar(0.18)).toContain("energy-pulse_1.8s");
    expect(bar(0.06)).toContain("energy-pulse_0.7s");
    expect(bar(0)).not.toContain("energy-pulse");
    expect(bar(0.06)).toContain("motion-reduce:animate-none");
  });
});

describe("EnergyNotice", () => {
  it("shows the banner with a dismiss button", () => {
    const html = renderToStaticMarkup(createElement(EnergyNotice, { threshold: 20, onDismiss: () => {} }));
    expect(html).toContain("⚡ Your energy is running low: under 20% left.");
    expect(html).toContain('aria-label="Dismiss"');
    expect(html).toContain('role="status"');
  });
});

describe("SpendBadge (spec §26.6)", () => {
  it("shows tokens and dollars, and the last turn when opened", () => {
    const html = renderToStaticMarkup(
      createElement(SpendBadge, { spend: { tokens: 4_200, cost: 31_000 }, lastTurn: { tokens: 1_800, cost: 9_000, inputTokens: 1_500, outputTokens: 300 } }),
    );
    expect(html).toContain("4.2k tok · $0.031");
    expect(html).toContain("Last turn");
    expect(html).toContain("1.5k tok in");
  });
  it("can say what the total covers", () => {
    expect(renderToStaticMarkup(createElement(SpendBadge, { spend: { tokens: 18_000, cost: 210_000 }, suffix: "today" }))).toContain("18k tok · $0.21 today");
  });
});
