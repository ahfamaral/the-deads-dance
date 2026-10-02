"use client";

import { useEffect, useRef, useState } from "react";
import { nextReveal } from "@/lib/reveal";

function prefersReducedMotion(): boolean {
  try {
    return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  } catch {
    return false;
  }
}

/**
 * Spec §18.6: while `active`, reveals `text` at a human pace; otherwise returns it whole.
 * Reduced-motion users get the text as it arrives.
 */
export function useRevealedText(text: string, active: boolean): string {
  const [shown, setShown] = useState(active ? 0 : text.length);
  const revealed = useRef(active ? 0 : text.length);
  const target = useRef(text.length);
  // Refs are written in effects, never during render (react-hooks/refs).
  useEffect(() => {
    target.current = text.length;
  }, [text]);

  useEffect(() => {
    if (!active || prefersReducedMotion()) return;
    let frame = 0;
    let last = performance.now();
    const tick = (now: number) => {
      revealed.current = nextReveal(revealed.current, target.current, now - last);
      last = now;
      setShown(Math.floor(revealed.current));
      frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [active]);

  if (!active || prefersReducedMotion()) return text;
  return text.slice(0, shown);
}
