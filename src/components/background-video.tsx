"use client";

import { useEffect, useRef, useState } from "react";
import { STILL_TIME } from "@/lib/threshold/scene";

type Orientation = "portrait" | "landscape";

/**
 * 2026-10-16: on a touch device the background is a pre-rendered loop of the canvas
 * (scripts/render-background-video.ts). The phone decodes it in hardware, so it costs a fraction
 * of drawing the scene live, so it plays on every screen.
 */
export default function BackgroundVideo() {
  const videoRef = useRef<HTMLVideoElement>(null);
  // Set after mount, so desktops never render the element or download the video.
  const [orientation, setOrientation] = useState<Orientation | null>(null);
  // Carried across a rotation, so the new video picks up where the old one was.
  const resumeAt = useRef(STILL_TIME);

  useEffect(() => {
    if (!window.matchMedia("(pointer: coarse)").matches) return;
    const landscape = window.matchMedia("(orientation: landscape)");
    const pick = () => {
      if (videoRef.current) resumeAt.current = videoRef.current.currentTime;
      setOrientation(landscape.matches ? "landscape" : "portrait");
    };
    pick();
    landscape.addEventListener("change", pick);
    return () => landscape.removeEventListener("change", pick);
  }, []);

  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;
    // React doesn't set the muted property, and a phone only plays a video on its own when muted.
    video.muted = true;
    const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)");

    // Spec §33.7: the voice screen plays the video inside its circle instead.
    const update = () => {
      const voiceOn = document.body.dataset.voice === "on";
      video.style.display = voiceOn ? "none" : "";
      if (!voiceOn && !reduceMotion.matches && !document.hidden) {
        // Refused in Low Power Mode, for example: the frame on screen stays.
        video.play().catch(() => {});
      } else {
        video.pause();
      }
    };
    const onLoaded = () => {
      video.currentTime = resumeAt.current;
      update();
    };

    video.addEventListener("loadedmetadata", onLoaded);
    if (document.body.dataset.voice === "on") video.style.display = "none";
    const voiceObserver = new MutationObserver(update);
    voiceObserver.observe(document.body, { attributes: true, attributeFilter: ["data-voice"] });
    document.addEventListener("visibilitychange", update);
    reduceMotion.addEventListener("change", update);
    return () => {
      video.removeEventListener("loadedmetadata", onLoaded);
      voiceObserver.disconnect();
      document.removeEventListener("visibilitychange", update);
      reduceMotion.removeEventListener("change", update);
    };
  }, [orientation]);

  if (!orientation) return null;
  return (
    <video
      ref={videoRef}
      key={orientation}
      src={`/background/${orientation}.mp4`}
      poster={`/background/${orientation}.jpg`}
      aria-hidden="true"
      muted
      loop
      playsInline
      preload="auto"
      disablePictureInPicture
      className="pointer-events-none fixed inset-0 z-0 h-full w-full object-cover"
    />
  );
}
