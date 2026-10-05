"use client";

import { useEffect, useRef } from "react";

type TurnstileApi = {
  render: (el: HTMLElement, opts: { sitekey: string; callback: (token: string) => void; "expired-callback": () => void; theme: "dark" }) => string;
  reset: (id: string) => void;
  remove: (id: string) => void;
};
declare global {
  interface Window {
    turnstile?: TurnstileApi;
  }
}

const SCRIPT = "https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit";

/** Spec §24.4: Cloudflare Turnstile. Usually invisible; reports a token, or null when it expires. */
export default function Turnstile({ siteKey, onToken, resetKey }: { siteKey: string; onToken: (token: string | null) => void; resetKey: number }) {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    let id: string | null = null;
    let cancelled = false;
    function mount() {
      if (cancelled || !ref.current || !window.turnstile) return;
      id = window.turnstile.render(ref.current, {
        sitekey: siteKey,
        callback: (token) => onToken(token),
        "expired-callback": () => onToken(null),
        theme: "dark",
      });
    }
    let script: HTMLScriptElement | null = null;
    if (window.turnstile) mount();
    else {
      script = document.querySelector<HTMLScriptElement>(`script[src="${SCRIPT}"]`);
      if (!script) {
        script = document.createElement("script");
        script.src = SCRIPT;
        script.async = true;
        document.head.appendChild(script);
      }
      script.addEventListener("load", mount);
    }
    return () => {
      cancelled = true;
      script?.removeEventListener("load", mount);
      if (id && window.turnstile) window.turnstile.remove(id);
    };
    // resetKey re-renders the widget after a failed send, so a used token isn't reused.
  }, [siteKey, onToken, resetKey]);

  return <div ref={ref} className="flex min-h-[65px] justify-center" />;
}
