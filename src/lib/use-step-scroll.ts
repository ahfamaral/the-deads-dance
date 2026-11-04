"use client";

import { useCallback, useEffect, useRef } from "react";

/**
 * Steps inside one page share its scroll: each new step starts at the top, and coming back to
 * `kept` (a long list) returns to where it was. Call the returned function as you leave `kept`.
 */
export function useStepScroll(step: string, kept: string): () => void {
  const saved = useRef(0);
  useEffect(() => {
    window.scrollTo({ top: step === kept ? saved.current : 0 });
  }, [step, kept]);
  return useCallback(() => {
    saved.current = window.scrollY;
  }, []);
}
