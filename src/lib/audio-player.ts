let context: AudioContext | null = null;

/**
 * Spec §33.4: one AudioContext per tab, created on first use. The Start tap calls this and resumes
 * it inside the gesture, which unlocks playback on iOS. Null on the server or without Web Audio.
 */
export function getAudioContext(): AudioContext | null {
  if (typeof window === "undefined") return null;
  if (!context) {
    const Ctor = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!Ctor) return null;
    context = new Ctor();
  }
  return context;
}
