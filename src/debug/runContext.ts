import type { CameraInfo } from "../capture/useWebcam";

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
  if (c.scaleSource === "shoulder-width") {
    lines.push(
      "  WARNING         hips were not visible, so torso scale used the weaker shoulder-width fallback — it shrinks as you blade into a stance"
    );
  }
  return lines.join("\n");
}
