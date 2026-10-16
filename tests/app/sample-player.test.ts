import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import SamplePlayer, { formatTime } from "@/components/sample-player";

describe("formatTime", () => {
  it("writes m:ss", () => {
    expect(formatTime(0)).toBe("0:00");
    expect(formatTime(7.9)).toBe("0:07");
    expect(formatTime(65)).toBe("1:05");
    expect(formatTime(Number.NaN)).toBe("0:00");
    expect(formatTime(Infinity)).toBe("0:00");
  });
});

describe("SamplePlayer", () => {
  it("renders a play button and no native controls before the sample has loaded", () => {
    const html = renderToStaticMarkup(createElement(SamplePlayer, { src: "/s.wav" }));
    expect(html).toContain('aria-label="Play sample"');
    expect(html).toContain("Loading sample…");
    expect(html).not.toContain("<audio");
  });
});
