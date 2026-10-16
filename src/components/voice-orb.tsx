"use client";

import { useEffect, useRef, useState } from "react";
import { createScene, STILL_TIME } from "@/lib/threshold/scene";
import type { VoiceStageKind } from "@/lib/voice-stage-state";

const SIZE = 150;
/** The speaking ring's canvas, centred on the orb with room for the wobble. */
const RING_BOX = 220;
const FRAME_INTERVAL = 1000 / 30;

/** Calls `draw` at most 30 times a second until the returned stop is called. */
function every30fps(draw: (seconds: number) => void): () => void {
  let frame = 0;
  let last = -Infinity;
  const tick = (timestamp: number) => {
    frame = requestAnimationFrame(tick);
    if (timestamp - last < FRAME_INTERVAL) return;
    last = timestamp;
    draw(timestamp / 1000);
  };
  frame = requestAnimationFrame(tick);
  return () => cancelAnimationFrame(frame);
}

function useMedia(query: string): boolean | null {
  const [matches, setMatches] = useState<boolean | null>(null);
  useEffect(() => {
    const media = window.matchMedia(query);
    const update = () => setMatches(media.matches);
    update();
    media.addEventListener("change", update);
    return () => media.removeEventListener("change", update);
  }, [query]);
  return matches;
}

/** Spec §33.7: the page background, drawn live in the circle on a desktop. */
function OrbScene({ reduceMotion }: { reduceMotion: boolean }) {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const canvas = ref.current;
    if (!canvas) return;
    let scene = null;
    try {
      scene = createScene(canvas, {
        viewport: () => ({ width: SIZE, height: SIZE, dpr: window.devicePixelRatio || 1 }),
        createCanvas: () => document.createElement("canvas"),
      });
    } catch (error) {
      console.warn("Orb background unavailable:", error);
    }
    if (!scene) return;
    const active = scene;
    active.resize();
    active.render(STILL_TIME);
    if (reduceMotion) return;
    // Starts at the still frame, so the first animated frame doesn't jump.
    let start: number | null = null;
    return every30fps((seconds) => {
      start ??= seconds;
      if (!document.hidden) active.render(STILL_TIME + seconds - start);
    });
  }, [reduceMotion]);
  return <canvas ref={ref} aria-hidden="true" className="absolute inset-0 size-full" />;
}

/** Spec §33.4: a thin white ring around the circle that wobbles with the voice's loudness. */
function SpeakingRing({ level }: { level: () => number }) {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const canvas = ref.current;
    const g = canvas?.getContext("2d");
    if (!canvas || !g) return;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    canvas.width = RING_BOX * dpr;
    canvas.height = RING_BOX * dpr;
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    const c = RING_BOX / 2;
    const radius = SIZE / 2 + 4;
    let lv = 0;
    return every30fps((t) => {
      lv += (level() - lv) * 0.35;
      g.clearRect(0, 0, RING_BOX, RING_BOX);
      // Two closed paths whose radius is a sum of sines, scaled by the loudness.
      for (let k = 0; k < 2; k++) {
        g.beginPath();
        for (let step = 0; step <= 180; step++) {
          const a = (step / 180) * Math.PI * 2;
          const w = Math.sin(a * 6 + t * 3 + k) * 0.5 + Math.sin(a * 11 - t * 4.2 + k * 2) * 0.35 + Math.sin(a * 3 + t * 1.7) * 0.15;
          const r = radius + k * 3 + w * lv * (18 - k * 6);
          const x = c + Math.cos(a) * r;
          const y = c + Math.sin(a) * r;
          if (step === 0) g.moveTo(x, y);
          else g.lineTo(x, y);
        }
        g.closePath();
        g.strokeStyle = k ? `rgba(255,255,255,${0.18 + lv * 0.2})` : `rgba(255,255,255,${0.45 + lv * 0.4})`;
        g.lineWidth = k ? 1 : 1.5;
        g.shadowColor = "rgba(255,255,255,0.6)";
        g.shadowBlur = 5 * lv;
        g.stroke();
      }
    });
  }, [level]);
  const offset = (RING_BOX - SIZE) / 2;
  return (
    <canvas
      ref={ref}
      aria-hidden="true"
      className="pointer-events-none absolute"
      style={{ left: -offset, top: -offset, width: RING_BOX, height: RING_BOX }}
    />
  );
}

/**
 * Spec §33.4 and §33.7: the 150 px circle with the background animation inside (a live scene on a
 * fine pointer, the portrait video on touch), a red glow while listening and a ring that follows
 * the voice while speaking. With reduced motion: the still frame, and a steady glow for the ring.
 */
export default function VoiceOrb({ state, level }: { state: VoiceStageKind; level: () => number }) {
  const coarse = useMedia("(pointer: coarse)");
  const reduceMotion = useMedia("(prefers-reduced-motion: reduce)") === true;
  const videoRef = useRef<HTMLVideoElement>(null);

  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;
    // React doesn't set the muted property, and a phone only plays a video on its own when muted.
    video.muted = true;
    if (reduceMotion) {
      video.pause();
      const still = () => (video.currentTime = STILL_TIME);
      if (video.readyState >= 1) still();
      else video.addEventListener("loadedmetadata", still, { once: true });
    } else video.play().catch(() => {});
  }, [coarse, reduceMotion]);

  const glow =
    state === "listening"
      ? "shadow-[0_0_0_4px_rgba(239,68,68,0.35),0_0_0_10px_rgba(239,68,68,0.12)]"
      : state === "speaking" && reduceMotion
        ? "shadow-[0_0_0_4px_rgba(255,255,255,0.28),0_0_0_10px_rgba(255,255,255,0.08)]"
        : "";

  return (
    <div className="relative size-[150px] shrink-0">
      {state === "speaking" && !reduceMotion && <SpeakingRing level={level} />}
      <div
        aria-hidden="true"
        className={`relative size-full overflow-hidden rounded-full border border-white/12 bg-[#050507] transition-shadow duration-300 motion-reduce:transition-none ${glow}`}
      >
        {coarse === false && <OrbScene reduceMotion={reduceMotion} />}
        {coarse === true && (
          <video
            ref={videoRef}
            src="/background/portrait.mp4"
            poster="/background/portrait.jpg"
            muted
            loop
            playsInline
            autoPlay={!reduceMotion}
            preload="auto"
            disablePictureInPicture
            className="absolute inset-0 size-full object-cover"
          />
        )}
      </div>
    </div>
  );
}
