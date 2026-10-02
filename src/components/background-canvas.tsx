"use client";

import { useEffect, useRef } from "react";
import { createScene, type Scene } from "@/lib/threshold/scene";

/** Frozen frame shown when motion is reduced — mid-breath, so it reads well. */
const STILL_TIME = 4.2;

export default function BackgroundCanvas() {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    let scene: Scene | null = null;
    try {
      scene = createScene(canvas);
    } catch (error) {
      // Losing the background should never cost the page its content.
      console.warn("Background unavailable:", error);
    }

    if (!scene) {
      canvas.style.display = "none";
      return;
    }

    const active = scene;
    const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)");

    let frame = 0;
    // Animation seconds elapsed, accumulated from frame deltas so a hidden
    // tab doesn't jump the composition forward on return.
    let elapsed = 0;
    let lastTimestamp: number | null = null;

    const tick = (timestamp: number) => {
      if (lastTimestamp !== null) {
        elapsed += (timestamp - lastTimestamp) / 1000;
      }
      lastTimestamp = timestamp;

      active.render(elapsed);
      frame = requestAnimationFrame(tick);
    };

    const stop = () => {
      cancelAnimationFrame(frame);
      frame = 0;
      lastTimestamp = null;
    };

    const start = () => {
      if (frame || reduceMotion.matches || document.hidden) return;
      frame = requestAnimationFrame(tick);
    };

    const onResize = () => {
      active.resize();
      if (!frame) active.render(reduceMotion.matches ? STILL_TIME : elapsed);
    };

    const onMotionPreferenceChange = () => {
      if (reduceMotion.matches) {
        stop();
        active.render(STILL_TIME);
      } else {
        start();
      }
    };

    const onVisibilityChange = () => {
      if (document.hidden) stop();
      else start();
    };

    active.render(reduceMotion.matches ? STILL_TIME : 0);
    start();

    window.addEventListener("resize", onResize);
    document.addEventListener("visibilitychange", onVisibilityChange);
    reduceMotion.addEventListener("change", onMotionPreferenceChange);

    return () => {
      stop();
      window.removeEventListener("resize", onResize);
      document.removeEventListener("visibilitychange", onVisibilityChange);
      reduceMotion.removeEventListener("change", onMotionPreferenceChange);
    };
  }, []);

  return (
    <canvas
      ref={canvasRef}
      aria-hidden="true"
      className="pointer-events-none fixed inset-0 z-0 h-full w-full"
    />
  );
}
