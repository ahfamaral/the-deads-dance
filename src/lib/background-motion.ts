/**
 * 2026-10-16: phones got warm with the background always animating. On a touch device it moves
 * only on the main menu; every other screen shows a still frame. The menu says when it is showing.
 */
type Listener = (menuShowing: boolean) => void;

let menuShowing = false;
const listeners = new Set<Listener>();

export function setMenuShowing(showing: boolean) {
  if (showing === menuShowing) return;
  menuShowing = showing;
  for (const listener of listeners) listener(showing);
}

export function isMenuShowing() {
  return menuShowing;
}

export function onMenuShowingChange(listener: Listener) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export type MotionState = {
  /** A touch device (`pointer: coarse`): a phone or a tablet. */
  touch: boolean;
  menuShowing: boolean;
  reduceMotion: boolean;
  hidden: boolean;
};

export function shouldAnimate({ touch, menuShowing, reduceMotion, hidden }: MotionState) {
  if (reduceMotion || hidden) return false;
  return !touch || menuShowing;
}
