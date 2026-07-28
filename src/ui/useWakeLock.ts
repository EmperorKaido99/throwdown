import { useEffect } from "react";

// Keeps the screen awake while the camera is running.
//
// Phone-specific, and it protects a measurement rather than comfort: a measured
// run is ~4.5 minutes of the player standing back throwing punches and never
// touching the device, which is comfortably past the default auto-lock on both
// iOS and Android. When the screen locks the camera track stops and rAF
// throttles, so the run does not fail loudly — it quietly stops recording and
// the remaining prompts are all scored as misses. Risk log 8's lesson, on a
// different device class.

/**
 * Screen Wake Lock. Unsupported on iOS below 16.4 and in some in-app browsers,
 * so this is best-effort — the caller must not depend on it.
 */
export function useWakeLock(active: boolean): void {
  useEffect(() => {
    if (!active) return;
    if (!("wakeLock" in navigator)) return;

    let sentinel: WakeLockSentinel | null = null;
    let cancelled = false;

    const acquire = async () => {
      try {
        sentinel = await navigator.wakeLock.request("screen");
      } catch {
        // Denied, or the tab is not visible. Nothing useful to do.
      }
    };

    // The lock is released automatically whenever the tab is backgrounded, and
    // is NOT restored on return — without this the protection silently lapses
    // after the first notification or app switch.
    const onVisible = () => {
      if (!cancelled && document.visibilityState === "visible") void acquire();
    };

    void acquire();
    document.addEventListener("visibilitychange", onVisible);

    return () => {
      cancelled = true;
      document.removeEventListener("visibilitychange", onVisible);
      void sentinel?.release().catch(() => {});
    };
  }, [active]);
}
