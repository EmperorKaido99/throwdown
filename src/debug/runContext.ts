import type { CameraInfo } from "../capture/useWebcam";
import type { ClassifierDiagnostics } from "../perception/punchClassifier";
import { PERCEPTION_CONFIG } from "../config/tuning";

// Captures the conditions a measured run happened under, and stamps them onto
// the report.
//
// docs/05 open question 7b lists what has to be recorded alongside a phone
// confusion matrix — device, browser, orientation, camera framing, pose rate at
// the start AND end of the run, and which delegate was engaged. A human running
// this alone, across the room from the device, will not remember to write those
// down, and a matrix without them cannot be compared against a later run on
// different hardware. Comparing them is the entire point, so the app collects
// them rather than asking.

export interface RunContext {
  at: string;
  /** Which build produced this run. See vite.config.ts BUILD_ID. */
  build: string;
  userAgent: string;
  screen: string;
  camera: string;
  delegate: string;
  /** Pose samples per second, derived from the median inter-frame interval. */
  poseFps: number;
}

export function captureRunContext(
  camera: CameraInfo | null,
  delegate: string | null,
  medianFrameIntervalMs: number
): RunContext {
  const orientation =
    window.innerHeight >= window.innerWidth ? "portrait" : "landscape";

  return {
    at: new Date().toISOString(),
    build: typeof __BUILD_ID__ === "string" ? __BUILD_ID__ : "unknown",
    userAgent: navigator.userAgent,
    screen: `${window.innerWidth}x${window.innerHeight} ${orientation} dpr${
      window.devicePixelRatio || 1
    }`,
    camera: camera
      ? `${camera.width}x${camera.height} @${camera.frameRate.toFixed(0)}fps — ${
          camera.label || "unlabelled"
        }`
      : "unknown",
    delegate: delegate ?? "unknown",
    poseFps: medianFrameIntervalMs > 0 ? 1000 / medianFrameIntervalMs : 0,
  };
}

export interface RunConditions {
  start: RunContext;
  end: RunContext | null;
  stance: string;
  repsPerType: number;
  torsoScale: number | null;
  scaleSource: string | null;
  /** Calibration problems flagged before the run started, if any. */
  calibrationWarnings: string[];
  /**
   * Detection diagnostics as they stood at the end of the run.
   *
   * This is the fix for what open question 1 called the blocking gap: run 1
   * reported a 19% detection rate and could not say WHY, because features are
   * only produced for punches that were detected — the 81% that failed were
   * invisible. Without this a repeat failure is equally uninterpretable, and
   * the only honest next step would be another five-minute run.
   */
  diagnostics: ClassifierDiagnostics | null;
}

/**
 * Report footer. Rendered as plain text so it survives being pasted anywhere,
 * which is how a result gets off a phone.
 */
export function formatRunConditions(c: RunConditions): string {
  const lines: string[] = [];
  lines.push("");
  lines.push("Run conditions");
  lines.push(`  when            ${c.start.at}`);
  lines.push(`  build           ${c.start.build}`);
  lines.push(`  device          ${c.start.userAgent}`);
  lines.push(`  screen          ${c.start.screen}`);
  lines.push(`  camera          ${c.start.camera}`);
  lines.push(`  delegate        ${c.start.delegate}`);
  lines.push(`  pose FPS start  ${c.start.poseFps.toFixed(1)}`);
  lines.push(
    `  pose FPS end    ${c.end ? c.end.poseFps.toFixed(1) : "not captured"}`
  );

  // A phone can start fast and thermally throttle partway through a ~4.5 minute
  // run, which would depress the back half of the matrix for reasons that have
  // nothing to do with the classifier. Flag it rather than leaving it to be
  // spotted in two decimal places.
  if (c.end && c.start.poseFps > 0) {
    const drop = (c.start.poseFps - c.end.poseFps) / c.start.poseFps;
    if (drop >= 0.2) {
      lines.push(
        `  WARNING         pose rate fell ${(drop * 100).toFixed(
          0
        )}% during the run — suspect thermal throttling; the later trials were sampled worse than the earlier ones`
      );
    }
  }

  lines.push(`  stance          ${c.stance}`);
  lines.push(`  reps per type   ${c.repsPerType}`);
  lines.push(
    `  torso scale     ${
      c.torsoScale === null ? "unknown" : c.torsoScale.toFixed(3)
    } (${c.scaleSource ?? "unknown"})`
  );
  for (const w of c.calibrationWarnings ?? []) {
    lines.push(`  WARNING         ${w}`);
  }

  const d = c.diagnostics;
  if (d) {
    const attempts = d.detections + d.rejections;
    lines.push("");
    lines.push("Detection gates");
    lines.push(
      `  attempts ${d.launches} · detected ${d.detections} · rejected ${d.rejections}` +
        ` · timed out ${d.timeouts}` +
        (attempts > 0
          ? ` · ${((d.detections / attempts) * 100).toFixed(0)}% pass`
          : "")
    );

    const reasons = Object.entries(d.byReason).sort((a, b) => b[1] - a[1]);
    if (reasons.length > 0) {
      lines.push("  rejected by gate:");
      for (const [reason, n] of reasons) {
        lines.push(`    ${reason.padEnd(22)} ${n}`);
      }
    }

    // The load-bearing numbers. A peak that never reached its gate means the
    // gate is unreachable for this player's punches at this framing, not merely
    // strict — which is a different problem with a different fix, and is
    // exactly the distinction run 1 could not make.
    // The actual numbers behind the most recent rejections. Without these a
    // report can say "rejected on excursion" while the peak-seen row says the
    // excursion gate was cleared twelvefold, and there is no way to tell from
    // the report which of the two is describing the punch.
    if (d.recent.length > 0) {
      lines.push("  last rejections (peak excursion / mean speed / samples):");
      for (const r of d.recent.slice(0, 6)) {
        const mean =
          r.durationMs > 0 ? r.peakExcursion / (r.durationMs / 1000) : 0;
        lines.push(
          `    ${r.hand.padEnd(6)} exc ${r.peakExcursion.toFixed(3)}` +
            `  mean ${mean.toFixed(2)}` +
            `  ${r.samples}f  ${r.durationMs.toFixed(0)}ms  — ${r.reason}`
        );
      }
    }

    lines.push("  peak seen vs gate (peak / gate):");
    for (const hand of ["left", "right"] as const) {
      const pk = d.peakSeen[hand];
      const mark = (seen: number, need: number) =>
        `${seen.toFixed(2)}/${need.toFixed(2)}${seen >= need ? "" : "  UNREACHED"}`;
      lines.push(
        `    ${hand.padEnd(6)} excursion ${mark(
          pk.excursion,
          PERCEPTION_CONFIG.minPunchExcursion
        )}`
      );
      lines.push(
        `    ${hand.padEnd(6)} speed     ${mark(
          pk.speed,
          PERCEPTION_CONFIG.minMeanSpeed
        )}`
      );
    }
  } else {
    lines.push("");
    lines.push("Detection gates   not captured");
  }

  return lines.join("\n");
}
