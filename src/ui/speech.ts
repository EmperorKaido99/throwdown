// Spoken prompts for the guided measurement protocol.
//
// This is a measurement-validity fix, not a convenience. The protocol runs on a
// fixed 1.4 s / 2.0 s cadence with the player standing back in boxing range. On
// a laptop the on-screen prompt is just about readable at that distance; on a
// phone it is not. A player who cannot reliably read which punch was asked for
// is guessing, and the confusion matrix then scores that guessing rather than
// the classifier — the same class of validity problem as risk log 12.
//
// Web Speech synthesis is used rather than audio files: no assets to ship, no
// network, and it is available in every mobile browser this project targets.

let warned = false;

export function speechSupported(): boolean {
  return typeof window !== "undefined" && "speechSynthesis" in window;
}

/**
 * Speak a short cue, replacing anything still in flight.
 *
 * Cancelling first matters: prompts arrive every 1.4 s and utterances queue by
 * default, so without it the voice would drift steadily further behind the
 * visual prompt and eventually announce the wrong punch.
 */
export function speak(text: string, rate = 1.15): void {
  if (!speechSupported()) return;
  try {
    window.speechSynthesis.cancel();
    const u = new SpeechSynthesisUtterance(text);
    u.rate = rate;
    u.volume = 1;
    window.speechSynthesis.speak(u);
  } catch (err) {
    if (!warned) {
      warned = true;
      console.warn("speech prompts unavailable:", err);
    }
  }
}

export function cancelSpeech(): void {
  if (!speechSupported()) return;
  try {
    window.speechSynthesis.cancel();
  } catch {
    // Nothing to do — the visual prompt still works.
  }
}

/**
 * iOS Safari refuses to speak until synthesis has been kicked off from inside a
 * user gesture. Call this from the click that starts a run, so the first real
 * cue is not silently swallowed.
 */
export function primeSpeech(): void {
  if (!speechSupported()) return;
  try {
    const u = new SpeechSynthesisUtterance("");
    u.volume = 0;
    window.speechSynthesis.speak(u);
  } catch {
    // Non-fatal.
  }
}
