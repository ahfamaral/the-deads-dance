"use client";

import { authClient } from "@/lib/auth-client";

export default function SignOutButton({ className }: { className?: string }) {
  return (
    <button
      type="button"
      onClick={async () => {
        await authClient.signOut();
        // eslint-disable-next-line @next/next/no-location-assign-relative-destination -- full reload so page.tsx re-picks the screen
        window.location.assign("/");
      }}
      className={className ?? "min-h-11 w-full rounded-full border border-white/15 px-4 text-sm text-neutral-200 transition-colors hover:bg-white/10"}
    >
      Sign out
    </button>
  );
}
