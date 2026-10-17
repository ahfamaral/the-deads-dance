/** Spec §33.4: marks a persona that can be talked to by voice; spec §33.6: a voice conversation in History (label). A drawn speaker with sound waves, like the gear. */
/** `color`: the icon's text colour class; grey by default, green in the persona picker (2026-10-17). */
export default function VoiceIcon({ label = "Voice available", color = "text-neutral-400" }: { label?: string; color?: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
      className={`ml-2 inline-block size-4 align-text-bottom ${color}`}
      role="img"
      aria-label={label}
    >
      <path d="M11 5 6 9H2v6h4l5 4z" />
      <path d="M15.5 8.5a5 5 0 0 1 0 7" />
      <path d="M19 5a10 10 0 0 1 0 14" />
    </svg>
  );
}
