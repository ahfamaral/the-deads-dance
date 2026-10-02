"use client";

import { useCallback, useRef, useState, type CSSProperties, type MouseEvent, type PointerEvent } from "react";

type FadeState = { top: boolean; bottom: boolean; pointerInFade: boolean };

/** How far the fade reaches into the list, in px. Rows inside it can't be hovered or clicked. */
const FADE_SIZE = 24;

/** Whether a point at clientY falls in an edge of el that is currently faded. */
function inFade(el: HTMLElement, clientY: number, top: boolean, bottom: boolean): boolean {
  const box = el.getBoundingClientRect();
  return (top && clientY < box.top + FADE_SIZE) || (bottom && clientY > box.bottom - FADE_SIZE);
}

/**
 * Tracks whether a scroll area has more content hidden above or below, so the
 * `scroll-fade` class (globals.css) can fade out only the edges that are cut.
 * While the pointer is over a faded edge the rows stop taking the pointer, so a
 * half-hidden row neither highlights nor can be pressed; the list itself still
 * takes the pointer, so scrolling there keeps working.
 * Returns the ref, data attributes, style and handlers to spread on the element.
 */
export function useScrollFade() {
  const [state, setState] = useState<FadeState>({ top: false, bottom: false, pointerInFade: false });
  // Last pointer height over the list, or null when it's elsewhere, so a scroll
  // under a still pointer can re-check whether it now sits in a fade.
  const pointerY = useRef<number | null>(null);
  const element = useRef<HTMLElement | null>(null);

  const recompute = useCallback(() => {
    const el = element.current;
    if (!el) return;
    const top = el.scrollTop > 1;
    const bottom = el.scrollTop + el.clientHeight < el.scrollHeight - 1;
    const pointerInFade = pointerY.current !== null && inFade(el, pointerY.current, top, bottom);
    setState((prev) =>
      prev.top === top && prev.bottom === bottom && prev.pointerInFade === pointerInFade
        ? prev
        : { top, bottom, pointerInFade },
    );
  }, []);

  // A callback ref, so it also attaches to a list that mounts later (after an
  // empty state); React 19 runs the returned cleanup when the element goes.
  const ref = useCallback(
    (el: HTMLElement | null) => {
      if (!el) return;
      element.current = el;
      recompute();
      el.addEventListener("scroll", recompute, { passive: true });
      // Resizing the window changes the visible height; adding or removing rows
      // changes the content height without resizing the element itself.
      const resize = new ResizeObserver(recompute);
      resize.observe(el);
      const mutation = new MutationObserver(recompute);
      mutation.observe(el, { childList: true });
      return () => {
        el.removeEventListener("scroll", recompute);
        resize.disconnect();
        mutation.disconnect();
        element.current = null;
      };
    },
    [recompute],
  );

  const onPointerMove = useCallback(
    (event: PointerEvent<HTMLElement>) => {
      pointerY.current = event.clientY;
      recompute();
    },
    [recompute],
  );

  const onPointerLeave = useCallback(() => {
    pointerY.current = null;
    recompute();
  }, [recompute]);

  // Backstop for a tap with no hover before it (touch): capture phase, so the
  // row's own button never sees the click.
  const onClickCapture = useCallback(
    (event: MouseEvent<HTMLElement>) => {
      // detail 0 is a keyboard press (Enter/Space); focus already scrolled it into view.
      if (event.detail === 0) return;
      if (inFade(event.currentTarget, event.clientY, state.top, state.bottom)) {
        event.preventDefault();
        event.stopPropagation();
      }
    },
    [state.top, state.bottom],
  );

  return {
    ref,
    onPointerMove,
    onPointerLeave,
    onClickCapture,
    style: { "--fade-size": `${FADE_SIZE}px` } as CSSProperties,
    "data-fade-top": state.top || undefined,
    "data-fade-bottom": state.bottom || undefined,
    "data-pointer-in-fade": state.pointerInFade || undefined,
  };
}
