import { describe, expect, it, vi } from "vitest";
import { isMenuShowing, onMenuShowingChange, setMenuShowing, shouldAnimate } from "@/lib/background-motion";

describe("shouldAnimate", () => {
  const base = { touch: false, menuShowing: false, reduceMotion: false, hidden: false };

  it("animates on every screen of a desktop", () => {
    expect(shouldAnimate(base)).toBe(true);
  });

  it("animates a touch device only on the main menu", () => {
    expect(shouldAnimate({ ...base, touch: true })).toBe(false);
    expect(shouldAnimate({ ...base, touch: true, menuShowing: true })).toBe(true);
  });

  it("never animates with reduced motion or a hidden tab", () => {
    expect(shouldAnimate({ ...base, menuShowing: true, reduceMotion: true })).toBe(false);
    expect(shouldAnimate({ ...base, menuShowing: true, hidden: true })).toBe(false);
  });
});

describe("menu showing signal", () => {
  it("tells listeners when it changes, once per change", () => {
    const listener = vi.fn();
    const stop = onMenuShowingChange(listener);
    setMenuShowing(true);
    setMenuShowing(true);
    expect(isMenuShowing()).toBe(true);
    setMenuShowing(false);
    expect(listener.mock.calls).toEqual([[true], [false]]);
    stop();
    setMenuShowing(true);
    expect(listener).toHaveBeenCalledTimes(2);
    setMenuShowing(false);
  });
});
