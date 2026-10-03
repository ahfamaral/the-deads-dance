/**
 * Spec §23.2: leaving an ended visit that isn't saved asks first. A visit still going, a saved one
 * and a record from history leave quietly, as before.
 */
export function shouldWarnBeforeLeaving(s: {
  ended: boolean;
  saveStatus: "idle" | "saved" | "error";
  readOnly: boolean;
}): boolean {
  return s.ended && !s.readOnly && s.saveStatus !== "saved";
}

/**
 * Spec §23.2: the end bar replaces the input once the visit has ended. Not while a reply is still
 * streaming (a retry of the exit turn): the input with its Stop stays until the reply lands.
 */
export function showEndBar(s: { ended: boolean; streaming: boolean }): boolean {
  return s.ended && !s.streaming;
}
