"use client";

import { useEffect, useRef, useState } from "react";

/** 7 -> "0:07", 65 -> "1:05". Anything not a finite, non-negative number reads as 0:00. */
export function formatTime(seconds: number): string {
  const whole = Number.isFinite(seconds) && seconds > 0 ? Math.floor(seconds) : 0;
  return `${Math.floor(whole / 60)}:${String(whole % 60).padStart(2, "0")}`;
}

type Load = "loading" | "error" | "ready";

/**
 * A small player for the admin's voice sample. It fetches the whole WAV first and plays the object URL,
 * so the duration is known up front (a streamed response has none, which broke the native controls).
 */
export default function SamplePlayer({ src }: { src: string }) {
  const audioRef = useRef<HTMLAudioElement>(null);
  const [objectUrl, setObjectUrl] = useState<string | null>(null);
  const [load, setLoad] = useState<Load>("loading");
  const [playing, setPlaying] = useState(false);
  const [time, setTime] = useState(0);
  const [duration, setDuration] = useState(0);

  useEffect(() => {
    let cancelled = false;
    let created: string | null = null;
    (async () => {
      try {
        const res = await fetch(src);
        if (!res.ok) throw new Error(String(res.status));
        const blob = await res.blob();
        if (cancelled) return;
        created = URL.createObjectURL(blob);
        setObjectUrl(created);
        setLoad("ready");
      } catch {
        if (!cancelled) setLoad("error");
      }
    })();
    return () => {
      cancelled = true;
      if (created) URL.revokeObjectURL(created);
    };
  }, [src]);

  function toggle() {
    const audio = audioRef.current;
    if (!audio) return;
    if (audio.paused) void audio.play().catch(() => setPlaying(false));
    else audio.pause();
  }

  function seek(event: React.MouseEvent<HTMLDivElement>) {
    const audio = audioRef.current;
    if (!audio || !duration) return;
    const box = event.currentTarget.getBoundingClientRect();
    const ratio = Math.min(1, Math.max(0, (event.clientX - box.left) / box.width));
    audio.currentTime = ratio * duration;
    setTime(audio.currentTime);
  }

  if (load === "error") return <p className="text-sm text-red-300">Couldn&apos;t load the sample.</p>;
  const ready = load === "ready";
  const fill = duration > 0 ? Math.min(100, (time / duration) * 100) : 0;
  return (
    <div className="flex items-center gap-2">
      {objectUrl && (
        <audio
          ref={audioRef}
          src={objectUrl}
          preload="auto"
          onLoadedMetadata={(e) => setDuration(e.currentTarget.duration)}
          onTimeUpdate={(e) => setTime(e.currentTarget.currentTime)}
          onPlay={() => setPlaying(true)}
          onPause={() => setPlaying(false)}
          onEnded={(e) => {
            e.currentTarget.currentTime = 0;
            setTime(0);
            setPlaying(false);
          }}
        />
      )}
      <button
        type="button"
        aria-label={playing ? "Pause sample" : "Play sample"}
        onClick={toggle}
        disabled={!ready}
        className="inline-flex size-11 shrink-0 items-center justify-center rounded-full text-neutral-200 transition-colors hover:bg-white/10 focus-visible:outline focus-visible:outline-white/40 disabled:opacity-40"
      >
        <svg viewBox="0 0 24 24" fill="currentColor" className="size-5" aria-hidden="true">
          {playing ? <path d="M7 5h3.5v14H7zM13.5 5H17v14h-3.5z" /> : <path d="M8 5.5v13a1 1 0 0 0 1.5.86l10.5-6.5a1 1 0 0 0 0-1.72L9.5 4.64A1 1 0 0 0 8 5.5z" />}
        </svg>
      </button>
      {!ready ? (
        <p role="status" className="text-sm text-neutral-400">
          Loading sample…
        </p>
      ) : (
        <>
          <div
            role="progressbar"
            aria-label="Sample progress"
            aria-valuemin={0}
            aria-valuemax={Math.round(duration)}
            aria-valuenow={Math.round(time)}
            onClick={seek}
            className="flex h-11 min-w-0 flex-1 cursor-pointer items-center"
          >
            <div className="h-1.5 w-full overflow-hidden rounded-full bg-white/15">
              <div className="h-full rounded-full bg-neutral-200" style={{ width: `${fill}%` }} />
            </div>
          </div>
          <span className="shrink-0 text-xs text-neutral-400 tabular-nums">
            {formatTime(time)} / {formatTime(duration)}
          </span>
        </>
      )}
    </div>
  );
}
