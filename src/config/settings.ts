// User-facing settings that persist across sessions.
//
// Deliberately separate from config/tuning.ts: tuning holds perception
// thresholds that a player must never be able to change (they are the thing
// being measured). This file holds display preferences only.

const STORAGE_KEY = "shadowbox.settings.v1";

export interface Settings {
  /** Draw the landmark skeleton over the camera feed. */
  showSkeleton: boolean;
  /** Additionally draw the unsmoothed skeleton in orange. */
  showRawSkeleton: boolean;
}

export const DEFAULT_SETTINGS: Settings = {
  showSkeleton: true,
  showRawSkeleton: false,
};

export function loadSettings(): Settings {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) return { ...DEFAULT_SETTINGS, ...(JSON.parse(raw) as Partial<Settings>) };
  } catch {
    // Private-mode or blocked storage. Defaults are a fine outcome.
  }
  return { ...DEFAULT_SETTINGS };
}

export function saveSettings(settings: Settings): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(settings));
  } catch {
    // Nothing to do — the session still works, the choice just won't persist.
  }
}

/**
 * The inference path is NOT stored here. `POSE_CONFIG.useWorker` reads
 * `?worker=0|1` from the URL at startup, so a stored preference could disagree
 * with the path actually running and the settings screen would lie. Changing it
 * also means re-creating the PoseLandmarker, so it is applied by reloading with
 * the flag set rather than hot-swapped mid-session. Risk log OQ3/OQ9.
 */
export function reloadWithWorker(useWorker: boolean): void {
  const url = new URL(window.location.href);
  url.searchParams.set("worker", useWorker ? "1" : "0");
  window.location.href = url.toString();
}
