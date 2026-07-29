// ALL tunable constants live here, per 01-ARCHITECTURE.md's module layout, so
// game feel and detection thresholds can be adjusted without touching logic.
//
// Milestone 0 only populates the pose/capture section. Perception, simulation
// and netcode constants get added as those layers are built — deliberately not
// pre-invented here, since 02-IMPLEMENTATION-PLAN.md's whole point is that
// their values are unknown until measured.

export const POSE_CONFIG = {
  /**
   * Model bundle and WASM runtime are served from public/ rather than a CDN so
   * loading can't break on a version mismatch between the npm package and a
   * remotely-hosted runtime. Both were taken from
   * node_modules/@mediapipe/tasks-vision@0.10.35 and verified byte-identical.
   *
   * pose_landmarker_lite is the fastest of the three bundles (lite/full/heavy).
   * Starting here to establish a frame-rate ceiling; if Milestone 1 shows
   * landmark quality is the limiting factor on punch classification rather than
   * frame rate, stepping up to `full` is the lever to try.
   */
  modelAssetPath: `${import.meta.env.BASE_URL}models/pose_landmarker_lite.task`,
  wasmRoot: `${import.meta.env.BASE_URL}mediapipe/wasm`,

  numPoses: 1,
  minPoseDetectionConfidence: 0.5,
  minPosePresenceConfidence: 0.5,
  minTrackingConfidence: 0.5,

  /**
   * Run inference in a Web Worker instead of on the main thread. Defaults OFF:
   * measured evidence is that it does not help and may hurt (13.8 vs 15.1 FPS),
   * and the worker cannot load under the Vite dev server (MediaPipe needs a
   * classic worker). Kept behind ?worker=1 against a production build so the
   * comparison can be re-run on better hardware. Risk log OQ3/OQ9.
   */
  get useWorker() {
    return queryFlag("worker", false);
  },
};

/**
 * Reads a numeric override from the query string, so measurement runs can A/B
 * capture settings without editing this file (e.g. ?camW=320&camH=240).
 * Returns the fallback when absent or malformed.
 */
function queryNumber(key: string, fallback: number): number {
  if (typeof window === "undefined") return fallback;
  const raw = new URLSearchParams(window.location.search).get(key);
  if (raw === null) return fallback;
  const n = Number(raw);
  return Number.isFinite(n) && n > 0 ? n : fallback;
}

/**
 * Boolean flag from the query string: ?key=0 / ?key=1.
 * Kept separate from queryNumber, which treats 0 as invalid (a zero-width
 * camera is nonsense, but a zero-valued flag is exactly how you turn something
 * off — folding the two together silently ignored ?worker=0).
 */
function queryFlag(key: string, fallback: boolean): boolean {
  if (typeof window === "undefined") return fallback;
  const raw = new URLSearchParams(window.location.search).get(key);
  if (raw === null) return fallback;
  return raw === "1" || raw === "true";
}

export const CAMERA_CONFIG = {
  /**
   * Requested capture resolution. Higher costs inference time; 640x480 matches
   * the Flap project's working baseline. These are requests, not guarantees —
   * the browser picks the closest mode the device supports, so the debug HUD
   * reports what was actually granted.
   *
   * Overridable via ?camW / ?camH — see the Milestone 0 measurements in
   * 05-TECH-SETUP-AND-RISK-LOG.md, where capture resolution turned out to be
   * the lever that decides whether inference fits inside one camera frame.
   */
  get width() {
    return queryNumber("camW", 640);
  },
  get height() {
    return queryNumber("camH", 480);
  },
  frameRate: 30,
};

export const SMOOTHING_DEFAULTS = {
  /**
   * One-euro filter parameters. Carried over from Flap's wrist tracking as a
   * starting point — these were tuned for flap detection, not punches, and
   * should be re-tuned during Milestone 1 against real punch trajectories.
   */
  minCutoff: 1.2,
  beta: 0.02,
  dCutoff: 1.0,
};

/**
 * Punch detection and classification (Milestone 1, Approach A).
 *
 * All distances are **torso-normalized**: 1.0 means one shoulder-to-hip
 * length, so the same numbers hold whether the player is near or far from the
 * camera, tall or short.
 *
 * These are starting values reasoned from the geometry, NOT tuned against
 * measured data. Milestone 1's job is to produce the confusion matrix that
 * says whether they are right — expect to revise them, and record what
 * changed and why in 05-TECH-SETUP-AND-RISK-LOG.md.
 */
export const PERCEPTION_CONFIG = {
  /** Below this landmark confidence, a frame is ignored rather than guessed at. */
  minLandmarkConfidence: 0.5,

  /** Good frames needed before calibration can be accepted. */
  calibrationMinSamples: 30,

  // --- Punch detection (the tractable half; see 03-GESTURE-CLASSIFICATION.md) ---

  /**
   * DETECTION GATES.
   *
   * Rebuilt after the first measured run detected only 19% of thrown punches
   * (risk log OQ1). The old design gated on wrist-to-shoulder distance, which a
   * punch thrown at the camera doesn't grow. Detection now keys on EXCURSION —
   * how far the fist has travelled from its calibrated guard, in any direction
   * — which has no blind axis and covers all four punch types with one gate.
   *
   * These are conservative floors, above resting jitter and below the weakest
   * modelled punch, NOT validated against real punches. The diagnostics panel
   * reports actual peaks reached; revisit from that data, not by passing a test.
   */

  /**
   * Floor for fist travel from guard, torso units. Effective threshold is the
   * larger of this and the player's measured guard jitter × guardNoiseMultiple.
   * Set below the smallest modelled punch — a fully foreshortened jab displaces
   * the fist only ~0.16 torso units, so anything near 0.2 rejects real punches.
   */
  minPunchExcursion: 0.13,
  /** Multiple of measured guard jitter treated as the noise ceiling. */
  guardNoiseMultiple: 3,
  /**
   * Ceiling on the jitter-scaled punch gate, torso units.
   *
   * The adaptation is worth keeping — it stops a shaky stance producing phantom
   * punches — but it had no upper bound, and that is what broke the run of
   * 2026-07-29 14:33. The player stood far enough back that torso scale halved
   * (0.243 against 0.536 the run before), landmark noise became a large
   * fraction of body size, measured guard jitter reached ~0.4 torso units, and
   * the gate inflated to 1.08-1.28 — roughly ten times the floor. Real punches
   * in that same run measured 0.66-1.29, so the gate had climbed into the
   * middle of the distribution it was meant to sit under.
   *
   * 0.40 sits well above the floor (0.13) and well below the weakest punch
   * observed on real hardware (0.66). Past this the calibration is not noisy,
   * it is wrong, and the honest response is to warn rather than to adapt.
   */
  maxPunchExcursionGate: 0.4,
  /**
   * Guard jitter above which a calibration is reported as untrustworthy rather
   * than merely noisy. Corresponds to the ceiling above, divided by the noise
   * multiple.
   */
  maxUsableGuardJitter: 0.13,
  /**
   * Torso scale below which the player is too small in frame for landmark noise
   * to stay a small fraction of body size. Measured: 0.536 gave usable jitter,
   * 0.243 gave jitter roughly 40x higher.
   */
  minUsableTorsoScale: 0.32,
  /** Below this excursion the hand counts as back at guard, re-arming. */
  guardExcursion: 0.07,
  /**
   * Minimum MEAN outward speed of the fist, torso-widths per second. Mean, not
   * peak: peak is measured between frames, so a slower camera under-reports it
   * and the same punch would pass at 30 FPS and fail at 15. Mean distance-over-
   * duration is sampling-invariant, which matters across the hardware this
   * targets. Set above what the excursion floor and duration ceiling jointly
   * imply (~0.19) but well below a real punch (~1.1).
   */
  minMeanSpeed: 0.35,
  /**
   * Minimum samples between launch and peak. At 15 FPS a fast punch's outward
   * travel spans barely two frames, so requiring three discarded real punches
   * on slower hardware.
   */
  minPunchSamples: 2,
  /** Minimum gap between two punches from the SAME hand (ms). */
  cooldownMs: 250,
  /** A punch taking longer than this is discarded as a slow reach, not a punch. */
  maxPunchDurationMs: 700,
  /** Trajectory samples kept per hand (~1.5s at 30fps). */
  historySize: 45,

  // --- Classification (the hard half) ---

  /** Inward horizontal travel (torso units) that starts to read as a hook. */
  hookInwardTravel: 0.28,
  /** Upward travel (torso units) that starts to read as an uppercut. */
  uppercutUpwardTravel: 0.3,
  /** Dropping this far below the shoulder line supports an uppercut reading. */
  uppercutChamberDepth: 0.25,
  /** Path/straight-line ratio above which motion reads as curved rather than straight. */
  curvedPathRatio: 1.18,
  /**
   * Minimum score margin between best and runner-up for a confident call.
   * Below this the classification is reported but flagged as low-confidence.
   */
  minConfidenceMargin: 0.15,

  // --- Dodge / duck detection (Milestone 2) ---
  //
  // Dead zones absorb natural sway and breathing. Milestone 2's done-when is
  // "no noticeable false triggers from normal head movement", so these are
  // the numbers that decide whether it passes — expect to tune them against
  // real movement, including simply standing and looking around.

  /** Lateral head offset ignored entirely, torso units. */
  dodgeDeadZone: 0.08,
  /** Lateral offset treated as a full-commitment dodge. */
  dodgeFullRange: 0.34,

  /** Head-toward-shoulders drop ignored entirely, torso units. */
  duckDeadZone: 0.07,
  /** Head drop treated as a full duck. */
  duckFullRange: 0.3,

  /**
   * Whole-body crouch (shoulder line dropping) thresholds. Separate from the
   * head-drop pair because bending the knees lowers head and shoulders
   * together, leaving their relative distance unchanged. Tolerances are wider:
   * this signal is measured against an absolute calibrated height, so it
   * drifts if the player moves toward or away from the camera.
   */
  bodyDropDeadZone: 0.12,
  bodyDropFullRange: 0.45,
};

export const DEBUG_CONFIG = {
  /** Minimum landmark confidence before a point/bone is drawn in the overlay. */
  minDrawConfidence: 0.3,
  /** Rolling window of per-frame samples used for the FPS/latency statistics. */
  perfWindowSize: 600,
};
