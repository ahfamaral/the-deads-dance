"use client";

import { useEffect, useRef } from "react";
import { isMenuShowing, onMenuShowingChange, shouldAnimate } from "@/lib/background-motion";
import { createScene, type Scene } from "@/lib/threshold/scene";

/** Frozen frame shown when motion is reduced — mid-breath, so it reads well. */
const STILL_TIME = 4.2;
/** The composition moves slowly, so 30 frames a second look the same as 60 or 120 at a fraction of the work. */
const FRAME_INTERVAL = 1000 / 30;

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
    const touch = window.matchMedia("(pointer: coarse)");

    let frame = 0;
    // Animation seconds elapsed, accumulated from frame deltas so a hidden
    // tab or a still screen doesn't jump the composition forward on return.
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

    const stillTime = () => (reduceMotion.matches ? STILL_TIME : elapsed);

    const stop = () => {
      cancelAnimationFrame(frame);
      frame = 0;
      lastTimestamp = null;
      lastDrawn = -Infinity;
    };

    // Starts or stops the loop to match the screen; a stopped canvas keeps its last frame.
    const update = () => {
      const animate = shouldAnimate({
        touch: touch.matches,
        menuShowing: isMenuShowing(),
        reduceMotion: reduceMotion.matches,
        hidden: document.hidden,
      });
      if (animate && !frame) frame = requestAnimationFrame(tick);
      else if (!animate && frame) stop();
    };

    const onResize = () => {
      active.resize();
      if (!frame) active.render(stillTime());
    };

    const onMotionPreferenceChange = () => {
      update();
      if (reduceMotion.matches) active.render(STILL_TIME);
    };

    active.render(stillTime());
    update();

    window.addEventListener("resize", onResize);
    document.addEventListener("visibilitychange", update);
    reduceMotion.addEventListener("change", onMotionPreferenceChange);
    touch.addEventListener("change", update);
    const stopListening = onMenuShowingChange(update);

    return () => {
      stop();
      window.removeEventListener("resize", onResize);
      document.removeEventListener("visibilitychange", update);
      reduceMotion.removeEventListener("change", onMotionPreferenceChange);
      touch.removeEventListener("change", update);
      stopListening();
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
