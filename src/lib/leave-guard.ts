/**
 * Spec §23.2: the end bar replaces the input once the visit has ended. Not while a reply is still
 * streaming (a retry of the exit turn): the input stays (busy) until the reply lands.
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

/**
 * Spec §32.4: after leaving a live conversation, ask for a rating, if the server has a visitor
 * message to rate. A record is rated from History instead; a deleted one can't be.
 */
export function shouldAskForRating(s: { hasUserMessage: boolean; readOnly: boolean; gone: boolean }): boolean {
  return s.hasUserMessage && !s.readOnly && !s.gone;
}
