import type { Trial } from "./confusionMatrix";
import type { RunConditions } from "./runContext";

// Persists the most recently completed measured run.
//
// A run is ~4.5 minutes of physical effort and is the project's actual
// deliverable. On a phone it is one accidental back-swipe, one low-battery
// prompt or one browser tab eviction away from being gone, and the only
// recovery is to throw eighty more punches. Cheap insurance.

const KEY = "shadowbox.lastRun.v1";

export interface SavedRun {
  savedAt: string;
  trials: Trial[];
  conditions: RunConditions;
}

export function saveRun(trials: Trial[], conditions: RunConditions): void {
  try {
    const payload: SavedRun = {
      savedAt: new Date().toISOString(),
      trials,
      conditions,
    };
    localStorage.setItem(KEY, JSON.stringify(payload));
  } catch {
    // Quota or private mode. The on-screen result is still there.
  }
}

export function loadRun(): SavedRun | null {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as SavedRun;
    return Array.isArray(parsed?.trials) && parsed.trials.length > 0
      ? parsed
      : null;
  } catch {
    return null;
  }
}

export function clearRun(): void {
  try {
    localStorage.removeItem(KEY);
  } catch {
    // Nothing to do.
  }
}

/**
 * Getting a report off a phone is the awkward step: the device running the test
 * is not the one with the notes on it. Web Share hands it to any messaging app;
 * clipboard is the desktop path and the fallback.
 */
export async function shareReport(report: string): Promise<"shared" | "copied" | "failed"> {
  if (navigator.share) {
    try {
      await navigator.share({ title: "Shadow Box measured run", text: report });
      return "shared";
    } catch {
      // User dismissed the sheet, or the browser refused. Fall through to copy.
    }
  }
  try {
    await navigator.clipboard.writeText(report);
    return "copied";
  } catch {
    return "failed";
  }
}
