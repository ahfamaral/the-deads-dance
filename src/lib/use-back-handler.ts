"use client";

import { useEffect, useRef } from "react";
import { createBackButton } from "@/lib/back-button";

const TRAP = "backTrap";

let instance: ReturnType<typeof createBackButton> | null = null;

/** The page's back button, made on first use in the browser (see createBackButton). */
function backButton() {
  if (instance) return instance;
  const openDialogs = () => document.querySelectorAll<HTMLDialogElement>("dialog[open]");
  const back = createBackButton({
    // Next.js copies its own router state into the entry (see its pushState patch), so it stays happy.
    push: () => window.history.pushState({ [TRAP]: true }, ""),
    back: () => window.history.back(),
    isTrap: () => (window.history.state as Record<string, unknown> | null)?.[TRAP] === true,
    closeTopDialog: () => {
      const all = openDialogs();
      const top = all[all.length - 1];
      top?.close(); // fires "close", which every window treats as Cancel / ✕
      return top !== undefined;
    },
    hasOpenDialog: () => openDialogs().length > 0,
  });
  window.addEventListener("popstate", back.onPopState);
  // Windows open and close by themselves (showModal, close, unmount), so watch for them.
  new MutationObserver(back.sync).observe(document.body, {
    subtree: true,
    childList: true,
    attributes: true,
    attributeFilter: ["open"],
  });
  instance = back;
  return back;
}

/** Starts the back button on every page, so open windows close on back even where no screen registers. */
export function useBackButton() {
  useEffect(() => {
    backButton().sync();
  }, []);
}

/**
 * The phone's back button runs `handler` while it's set, like the screen's own Back; null hands the
 * button back (the start menu). Windows need nothing: back closes them as Escape does.
 */
export function useBackHandler(handler: (() => void) | null) {
  const latest = useRef(handler);
  useEffect(() => {
    latest.current = handler;
  });
  const active = handler !== null;
  useEffect(() => {
    if (!active) return;
    const entry = backButton().register(() => latest.current?.());
    return entry.remove;
  }, [active]);
}
