/** What the back button needs from the browser; faked in tests. */
export type BackEnv = {
  /** Adds a trap entry on top of the history, at the same address. */
  push(): void;
  /** Goes one entry back; a popstate follows later. */
  back(): void;
  /** Whether the current history entry is a trap. */
  isTrap(): boolean;
  /** Closes the topmost open window (like Escape); false when none is open. */
  closeTopDialog(): boolean;
  hasOpenDialog(): boolean;
};

type Entry = { run: () => void };

/**
 * 2026-10-17: the phone's back button does what the app's own Back does. The whole app is one address,
 * so while a screen with a Back (`register`) or any window is open, one extra "trap" entry sits on top
 * of the history. Pressing back pops it: the topmost window closes as on Escape (Cancel, ✕, Skip), or
 * else the latest screen's Back runs; then the trap goes back up if it's still needed. With neither
 * (the start menu), the trap is removed, so back leaves as on any site. Syncs wait a microtask, so a
 * screen swapped for another in one render doesn't touch the history.
 */
export function createBackButton(env: BackEnv) {
  const screens: Entry[] = [];
  let trapped = env.isTrap();
  let removing = false;
  let queued = false;

  function syncNow() {
    queued = false;
    if (removing) return; // the popstate of that removal syncs again
    // A link to another page pushes a plain entry with no popstate, so ask the history, not memory:
    // going back from there would undo the link (the add button jumped back to the start page).
    trapped = env.isTrap();
    const needed = screens.length > 0 || env.hasOpenDialog();
    if (needed && !trapped) {
      env.push();
      trapped = true;
    } else if (!needed && trapped) {
      removing = true;
      trapped = false;
      env.back();
    }
  }

  function sync() {
    if (queued) return;
    queued = true;
    queueMicrotask(syncNow);
  }

  function onPopState() {
    if (removing) {
      removing = false;
      trapped = env.isTrap();
      sync();
      return;
    }
    // Our trap was popped only if we sat on one and have now left it; anything else (a forward onto a
    // trap, another page of the app) runs nothing.
    const consumed = trapped && !env.isTrap();
    trapped = env.isTrap();
    if (consumed && !env.closeTopDialog()) screens.at(-1)?.run();
    sync();
  }

  function register(run: () => void) {
    const entry: Entry = { run };
    screens.push(entry);
    sync();
    return {
      update(next: () => void) {
        entry.run = next;
      },
      remove() {
        const i = screens.indexOf(entry);
        if (i >= 0) screens.splice(i, 1);
        sync();
      },
    };
  }

  return { register, onPopState, sync };
}
