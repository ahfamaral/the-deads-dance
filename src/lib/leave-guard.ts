/**
 * Spec §23.2: the end bar replaces the input once the visit has ended. Not while a reply is still
 * streaming (a retry of the exit turn): the input with its Stop stays until the reply lands.
 */
export function showEndBar(s: { ended: boolean; streaming: boolean }): boolean {
  return s.ended && !s.streaming;
}

/**
 * Spec §25.5: leaving a live chat freezes it (it reopens from History, read-only), so Back asks
 * first while the conversation is still going. Nothing to lose otherwise: no message sent yet, the
 * persona already ended it, a record from History, or a conversation deleted elsewhere.
 */
export function confirmBeforeLeaving(s: { readOnly: boolean; ended: boolean; gone: boolean; hasMessages: boolean }): boolean {
  return s.hasMessages && !s.ended && !s.readOnly && !s.gone;
}
