"use client";

import { useEffect, useRef } from "react";
import { createScene, STILL_TIME, type Scene } from "@/lib/threshold/scene";

/** The composition moves slowly, so 30 frames a second look the same as 60 or 120 at a fraction of the work. */
const FRAME_INTERVAL = 1000 / 30;

/** The live background, for a mouse or trackpad. Touch devices play a video instead (BackgroundVideo). */
export default function BackgroundCanvas() {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    if (window.matchMedia("(pointer: coarse)").matches) {
      canvas.style.display = "none";
      return;
    }

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
    let lastDrawn = -Infinity;

    const tick = (timestamp: number) => {
      frame = requestAnimationFrame(tick);
      if (lastTimestamp !== null) {
        elapsed += (timestamp - lastTimestamp) / 1000;
      }
      lastTimestamp = timestamp;

      if (timestamp - lastDrawn < FRAME_INTERVAL) return;
      lastDrawn = timestamp;
      active.render(elapsed);
    };

    const stop = () => {
      cancelAnimationFrame(frame);
      frame = 0;
      lastTimestamp = null;
      lastDrawn = -Infinity;
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
