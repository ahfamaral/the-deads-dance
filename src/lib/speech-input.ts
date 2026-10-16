/** Spec §33.4: whether this browser has speech recognition (Chrome and Safari do; Firefox does not). */
export function speechSupported(): boolean {
  return typeof window !== "undefined" && ("SpeechRecognition" in window || "webkitSpeechRecognition" in window);
}
