// Punch detection and type classification — Approach A from
// 03-GESTURE-CLASSIFICATION.md: a guard-state FSM plus geometric/velocity
// heuristics on the shoulder-elbow-wrist chain.
//
// Detection (was a punch thrown?) and classification (which punch?) are kept
// separate. Detection is tractable; classification is the open problem this
// milestone exists to measure, since curved punches thrown at the camera are
// foreshortened along the very axis that distinguishes them. Nothing reads z
// (see geometry.ts).

import type { PoseFrame, Keypoint } from "../pose/poseTypes";
import { PERCEPTION_CONFIG as C } from "../config/tuning";

/** Samples used for the resting-excursion baseline (~1.5s at 20 FPS). */
const RESTING_WINDOW = 30;
import { allVisible, angleDeg, dist } from "./geometry";
import type { CalibrationData } from "./calibration";
import {
  PUNCH_FAMILY,
  leadHand,
  punchTypeFor,
  type HandSide,
  type PunchEvent,
  type PunchFeatures,
  type PunchType,
} from "./punchTypes";

interface Sample {
  t: number;
  wrist: { x: number; y: number };
  /**
   * Distance the fist has travelled from its calibrated guard position, in
   * torso units. Detection keys on this, not on `extension`.
   *
   * A punch thrown at the lens moves the fist toward the camera, so its 2D
   * distance from the shoulder barely grows — the extension-based design it
   * replaced detected only 19% of real punches (risk log OQ1). Excursion from
   * guard has no such blind axis and is direction-agnostic, so one gate serves
   * straights, hooks and uppercuts alike.
   */
  excursion: number;
  /** Torso-normalized speed of the wrist, torso-widths per second. */
  speed: number;
  extension: number; // torso-normalized wrist-to-shoulder distance (feature only)
  elbowAngle: number;
  /** Signed horizontal offset from the body midline, torso units, inward-positive. */
  inward: number;
  /** Height above the shoulder line, torso units, up-positive. */
  height: number;
}

type Phase = "guard" | "punching";

/** Live per-hand state, surfaced for the debug overlay. */
export interface HandDebugState {
  phase: Phase;
  extension: number;
  elbowAngle: number;
  speed: number;
}

/** Why a candidate punch failed the detection gates. */
export interface RejectionRecord {
  hand: HandSide;
  reason: string;
  peakExcursion: number;
  peakExtension: number;
  extensionGain: number;
  elbowOpening: number;
  peakSpeed: number;
  durationMs: number;
  samples: number;
  at: number;
}

/**
 * Instrumentation for diagnosing detection failures. Features are only produced
 * for punches that PASS the gates, so `peakSeen` records the highest value each
 * signal reached regardless of detection: if a peak sits below its gate, the
 * gate is unreachable for that player rather than merely strict.
 */
export interface ClassifierDiagnostics {
  /**
   * Episodes in which the fist genuinely cleared the guard radius. NOT the
   * number of times the FSM entered its punching phase — tracking starts on the
   * first outward twitch so the wind-up is inside the measured window, and
   * counting those made standing still look like ~30 punch attempts a minute.
   */
  launches: number;
  detections: number;
  rejections: number;
  /** Cleared guard but never came back inside maxPunchDurationMs. */
  timeouts: number;
  byReason: Record<string, number>;
  recent: RejectionRecord[];
  peakSeen: Record<
    HandSide,
    { excursion: number; extension: number; speed: number; elbowOpen: number }
  >;
}

/** Mutable diagnostics shared by both hands. */
function emptyDiagnostics(): ClassifierDiagnostics {
  return {
    launches: 0,
    detections: 0,
    rejections: 0,
    timeouts: 0,
    byReason: {},
    recent: [],
    peakSeen: {
      left: { excursion: 0, extension: 0, speed: 0, elbowOpen: 0 },
      right: { excursion: 0, extension: 0, speed: 0, elbowOpen: 0 },
    },
  };
}

class HandTracker {
  private history: Sample[] = [];
  private phase: Phase = "guard";
  private launchIndex = 0;
  private peakIndex = 0;
  private lastPunchAt = -Infinity;
  /**
   * Has the fist actually left the guard radius during the current episode?
   *
   * Without this the episode could finalise on the frame after it started, back
   * inside the guard radius it had never left, reporting a near-zero excursion
   * for a punch that went on to travel ten times the gate. That is the
   * 2026-07-29 phone run: 29 launches, 27 rejections all naming the excursion
   * gate, peak excursion actually seen 1.54 against a 0.13 gate.
   */
  private clearedGuard = false;
  /**
   * Excursion the fist sits at when it is NOT punching, as a rolling minimum.
   *
   * Everything used to be measured from the guard position recorded at
   * calibration, which assumes that snapshot is where the hand actually rests.
   * Run 4 (2026-07-29) showed the cost when it is not: calibration had been
   * taken while the player was still settling, so the reference sat ~0.3 torso
   * units from the real guard. The fist's resting excursion therefore exceeded
   * the re-arm radius permanently — it could never read as "at guard", so 80
   * punches produced 8 launches and not one closed episode.
   *
   * Measuring travel from where the fist actually rests makes a wrong
   * calibration an offset that cancels, instead of a permanent bias. The
   * calibrated guard is still the origin; this just removes its error.
   */
  private restingExcursion = 0;
  /** Resting level at the moment the current episode launched. */
  private launchResting = 0;
  private speed = 0;
  private side: HandSide;
  private diag: ClassifierDiagnostics;

  constructor(side: HandSide, diag: ClassifierDiagnostics) {
    this.side = side;
    this.diag = diag;
  }

  get debug(): HandDebugState {
    const last = this.history[this.history.length - 1];
    return {
      phase: this.phase,
      extension: last?.extension ?? 0,
      elbowAngle: last?.elbowAngle ?? 0,
      speed: this.speed,
    };
  }

  reset(): void {
    this.history = [];
    this.phase = "guard";
    this.speed = 0;
    this.clearedGuard = false;
    this.restingExcursion = 0;
    this.launchResting = 0;
    this.lastPunchAt = -Infinity;
  }

  /**
   * Feeds one frame. Returns a PunchEvent at the moment a punch completes
   * (peak extension reached and the hand starts back toward guard), else null.
   */
  update(pose: PoseFrame, cal: CalibrationData, now: number): PunchEvent | null {
    const shoulder = this.side === "left" ? pose.leftShoulder : pose.rightShoulder;
    const elbow = this.side === "left" ? pose.leftElbow : pose.rightElbow;
    const wrist = this.side === "left" ? pose.leftWrist : pose.rightWrist;

    if (!allVisible(C.minLandmarkConfidence, shoulder, elbow, wrist)) {
      // Losing the arm mid-punch would otherwise produce a garbage trajectory.
      if (this.phase === "punching") this.abort();
      return null;
    }

    const sample = this.toSample(shoulder, wrist, elbow, cal, now);
    this.pushSample(sample);

    if (this.phase === "guard") {
      this.maybeLaunch(sample, now, cal);
      return null;
    }
    return this.trackPunch(sample, now, cal);
  }

  private toSample(
    shoulder: Keypoint,
    wrist: Keypoint,
    elbow: Keypoint,
    cal: CalibrationData,
    now: number
  ): Sample {
    const scale = cal.torsoScale;
    // Inward is toward the body midline, so its sign depends on which side of
    // the body the hand is on. MediaPipe's "left" is the subject's anatomical
    // left, which appears on the right of an unmirrored image — hence the
    // left hand's inward direction is negative-x.
    const rawOffset = wrist.x - cal.midlineX;
    const inward = (this.side === "left" ? -rawOffset : rawOffset) / scale;

    // Displacement from the calibrated guard, in shoulder-relative torso units.
    const guard = cal.guardWrist[this.side];
    const offX = (wrist.x - shoulder.x) / scale - guard.x;
    const offY = (wrist.y - shoulder.y) / scale - guard.y;

    const prev = this.history[this.history.length - 1];
    let speed = 0;
    if (prev) {
      const dt = Math.max((now - prev.t) / 1000, 1e-3);
      // Torso-normalized to match the units the speed threshold is expressed in.
      speed =
        Math.hypot(wrist.x - prev.wrist.x, wrist.y - prev.wrist.y) / scale / dt;
    }

    return {
      t: now,
      wrist: { x: wrist.x, y: wrist.y },
      excursion: Math.hypot(offX, offY),
      speed,
      extension: dist(wrist, shoulder) / scale,
      elbowAngle: angleDeg(shoulder, elbow, wrist),
      inward,
      // y grows downward in image space, so flip it to make up positive.
      height: (cal.shoulderY - wrist.y) / scale,
    };
  }

  private pushSample(s: Sample): void {
    this.history.push(s);

    // When the ring buffer slides, every stored index shifts down by one. This
    // must key off an actual shift (> capacity), not off reaching capacity, or
    // launch/peak get decremented against a buffer that never moved.
    if (this.history.length > C.historySize) {
      this.history.shift();
      this.launchIndex = Math.max(0, this.launchIndex - 1);
      this.peakIndex = Math.max(0, this.peakIndex - 1);
    }

    this.speed = s.speed;

    // Rolling minimum over roughly the last 1.5s. A punch only ever raises
    // excursion, so it cannot drag this down; what it tracks is the floor the
    // fist keeps returning to.
    const window = this.history.slice(-RESTING_WINDOW);
    let lowest = Infinity;
    for (const w of window) lowest = Math.min(lowest, w.excursion);
    this.restingExcursion = Number.isFinite(lowest) ? lowest : 0;

    // Running maxima, independent of detection — these reveal an unreachable gate.
    const peak = this.diag.peakSeen[this.side];
    peak.excursion = Math.max(peak.excursion, s.excursion);
    peak.extension = Math.max(peak.extension, s.extension);
    peak.speed = Math.max(peak.speed, s.speed);
  }

  private abort(): void {
    this.phase = "guard";
    this.clearedGuard = false;
  }

  /**
   * Punch threshold for this player: the larger of a configured floor and a
   * multiple of the player's own measured guard jitter, so a shaky stance or a
   * noisy camera raises the bar automatically instead of firing phantom punches.
   */
  private minExcursion(cal: CalibrationData): number {
    return Math.min(
      C.maxPunchExcursionGate,
      Math.max(
        C.minPunchExcursion,
        cal.guardJitter[this.side] * C.guardNoiseMultiple
      )
    );
  }

  /** Excursion below which the hand counts as back at guard and re-arms. */
  private reArmExcursion(cal: CalibrationData): number {
    // Clamped for the same reason as minExcursion, and it matters just as much:
    // an inflated re-arm radius is what a fist has to travel past before the
    // episode counts as an attempt at all, and what it has to come back inside
    // before the episode can close. In the 2026-07-29 run this reached ~0.7
    // torso units and produced 77 timeouts against 2 detections.
    return Math.min(
      C.maxPunchExcursionGate * 0.6,
      Math.max(
        C.guardExcursion,
        cal.guardJitter[this.side] * C.guardNoiseMultiple * 0.6
      )
    );
  }

  private maybeLaunch(s: Sample, now: number, cal: CalibrationData): void {
    if (now - this.lastPunchAt < C.cooldownMs) return;
    const prev = this.history[this.history.length - 2];
    if (!prev) return;

    // Launch when the fist leaves guard and is still moving away from it.
    // Requiring the previous sample to sit inside the guard radius is the
    // re-arming rule: an already-extended hand can't re-trigger on small drift.
    const nearGuard =
      prev.excursion - this.restingExcursion < this.reArmExcursion(cal);
    const leaving = s.excursion > prev.excursion;

    if (nearGuard && leaving) {
      // Start tracking on the first outward twitch so the wind-up sits inside
      // the measured window — an uppercut chambers down before it drives up.
      // This is NOT yet a punch attempt: guard jitter drifts outward roughly
      // every other frame, so counting it here reported tens of attempts a
      // minute from someone standing still. The count moves to the moment the
      // fist actually clears the guard radius.
      this.phase = "punching";
      this.clearedGuard = false;
      this.launchResting = this.restingExcursion;
      this.launchIndex = this.history.length - 2;
      this.peakIndex = this.history.length - 1;
    }
  }

  private trackPunch(s: Sample, now: number, cal: CalibrationData): PunchEvent | null {
    const launch = this.history[this.launchIndex];
    const peak = this.history[this.peakIndex];
    if (!launch || !peak) {
      this.abort();
      return null;
    }

    // A punch is the WHOLE excursion episode — fist leaving guard to returning
    // — not the first local peak. Finalising on the first peak swallowed an
    // uppercut's real drive behind its chamber (any wind-up has that shape).
    if (s.excursion > peak.excursion) {
      this.peakIndex = this.history.length - 1;
    }

    const reArm = this.reArmExcursion(cal);
    const travel = s.excursion - this.launchResting;

    // The fist has genuinely left guard. Only now is this a punch attempt.
    if (!this.clearedGuard && travel > reArm) {
      this.clearedGuard = true;
      this.diag.launches++;
    }

    if (now - launch.t > C.maxPunchDurationMs) {
      // Left guard and never came back in a plausible time — a reach or a
      // block, not a punch. A wobble that never cleared guard at all is not
      // even that, and is dropped without polluting the rejection log.
      if (this.clearedGuard) {
        this.diag.timeouts++;
        this.recordTimeout(launch, this.history[this.peakIndex], now);
      }
      this.abort();
      return null;
    }

    if (!this.clearedGuard) return null;

    // The episode is over when the fist is back at guard, OR when it has
    // clearly retracted from its own peak. The second condition exists because
    // the first trusts the calibrated guard point, and a guard point taken
    // while the player was still settling is simply wrong — run 4 timed out on
    // all 8 attempts for exactly that reason.
    const peakTravel = this.history[this.peakIndex].excursion - this.launchResting;
    const home = travel <= reArm;
    const retracted = travel <= peakTravel * C.retractionFraction;
    if (!home && !retracted) return null;

    // Fist is back at guard: the episode is complete. Decide whether the
    // motion we just saw actually qualifies.
    const done = this.finalize(launch, this.history[this.peakIndex], cal);
    this.phase = "guard";
    if (done) this.lastPunchAt = now;
    return done;
  }

  /**
   * A timed-out episode leaves no trace otherwise. Run 4 reported 8 timeouts
   * against an empty rejection log, and there was no way to tell from the
   * report how far those punches had travelled before the episode stalled.
   */
  private recordTimeout(launch: Sample, peak: Sample, now: number): void {
    this.diag.recent.unshift({
      hand: this.side,
      reason: `timeout after ${(now - launch.t).toFixed(0)}ms, never returned to guard`,
      peakExcursion: Math.max(0, peak.excursion - this.launchResting),
      peakExtension: peak.extension,
      extensionGain: peak.extension - launch.extension,
      elbowOpening: peak.elbowAngle - launch.elbowAngle,
      peakSpeed: this.speed,
      durationMs: now - launch.t,
      samples: Math.max(0, this.peakIndex - this.launchIndex + 1),
      at: peak.t,
    });
    this.diag.recent.length = Math.min(this.diag.recent.length, 12);
  }

  private finalize(
    launch: Sample,
    peak: Sample,
    cal: CalibrationData
  ): PunchEvent | null {
    const window = this.history.slice(this.launchIndex, this.peakIndex + 1);
    const durationMs = peak.t - launch.t;
    const extensionGain = peak.extension - launch.extension;
    const elbowOpening = peak.elbowAngle - launch.elbowAngle;

    let peakSpeed = 0;
    let pathLength = 0;
    for (let i = 1; i < window.length; i++) {
      const a = window[i - 1];
      const b = window[i];
      pathLength +=
        Math.hypot(b.wrist.x - a.wrist.x, b.wrist.y - a.wrist.y) / cal.torsoScale;
      peakSpeed = Math.max(peakSpeed, b.speed);
    }
    // Travel from where the fist actually rested, not from the calibrated guard
    // point — see restingExcursion.
    const peakExcursion = Math.max(0, peak.excursion - this.launchResting);
    // Mean outward velocity, torso-widths per second. Gated instead of PEAK
    // speed, which is frame-rate dependent: a slower camera under-reports the
    // true peak, so the same punch would pass at 30 FPS and fail at 15. Mean
    // distance-over-duration has no such dependence.
    const meanSpeed = durationMs > 0 ? peakExcursion / (durationMs / 1000) : 0;

    // Reject non-punches: slow reaches, small adjustments, guard fidgeting.
    // The first failing gate is recorded so a failed run can name the culprit.
    // Extension and elbow opening are deliberately NOT gated — both collapse
    // under foreshortening (the 19% run) and survive only as classification
    // features, where being weak costs accuracy rather than the whole punch.
    const reason =
      peakExcursion < this.minExcursion(cal)
        ? `excursion ${peakExcursion.toFixed(2)} < ${this.minExcursion(cal).toFixed(2)}`
        : meanSpeed < C.minMeanSpeed
          ? `mean speed ${meanSpeed.toFixed(2)} < ${C.minMeanSpeed}`
          : durationMs > C.maxPunchDurationMs
            ? `duration ${durationMs.toFixed(0)}ms > ${C.maxPunchDurationMs}ms`
            : window.length < C.minPunchSamples
              ? `only ${window.length} samples (need ${C.minPunchSamples})`
              : null;

    this.diag.peakSeen[this.side].elbowOpen = Math.max(
      this.diag.peakSeen[this.side].elbowOpen,
      elbowOpening
    );

    if (reason !== null) {
      this.diag.rejections++;
      // Bucket by gate name, dropping the numbers, so counts aggregate.
      const key = reason.replace(/[-\d.]+/g, "").replace(/\s+/g, " ").trim();
      this.diag.byReason[key] = (this.diag.byReason[key] ?? 0) + 1;
      this.diag.recent.unshift({
        hand: this.side,
        reason,
        peakExcursion,
        peakExtension: peak.extension,
        extensionGain,
        elbowOpening,
        peakSpeed,
        durationMs,
        samples: window.length,
        at: peak.t,
      });
      this.diag.recent.length = Math.min(this.diag.recent.length, 12);
      return null;
    }

    this.diag.detections++;

    const straightLine = Math.hypot(
      (peak.wrist.x - launch.wrist.x) / cal.torsoScale,
      (peak.wrist.y - launch.wrist.y) / cal.torsoScale
    );

    // Vertical travel is measured from the LOWEST point reached, not from
    // launch: an uppercut chambers down before driving up, so launch-to-peak
    // understates its rise.
    let lowestHeight = launch.height;
    for (const w of window) lowestHeight = Math.min(lowestHeight, w.height);

    const features: PunchFeatures = {
      peakExcursion,
      inwardTravel: peak.inward - launch.inward,
      upwardTravel: peak.height - lowestHeight,
      extensionGain,
      peakExtension: peak.extension,
      elbowAngleStart: launch.elbowAngle,
      elbowAnglePeak: peak.elbowAngle,
      peakSpeed,
      curvature: straightLine > 1e-3 ? pathLength / straightLine : 1,
      lowestHeight,
      durationMs,
      sampleCount: window.length,
    };

    return buildEvent(features, this.side, cal, peak.t);
  }
}

/**
 * Scores the three motion families against the measured features, then maps the
 * winner onto a punch type using the calibrated stance. Scores are deliberately
 * simple and additive so a misclassification can be read off the per-type
 * scores in the debug UI — Approach A exists to be diagnosed, then kept or dropped.
 */
function buildEvent(
  f: PunchFeatures,
  side: HandSide,
  cal: CalibrationData,
  timestamp: number
): PunchEvent {
  const hookScore =
    ratio(f.inwardTravel, C.hookInwardTravel) * 1.0 +
    ratio(f.curvature - 1, C.curvedPathRatio - 1) * 0.5;

  const uppercutScore =
    ratio(f.upwardTravel, C.uppercutUpwardTravel) * 1.0 +
    ratio(-f.lowestHeight, C.uppercutChamberDepth) * 0.6 +
    ratio(f.curvature - 1, C.curvedPathRatio - 1) * 0.3;

  // A straight punch is characterised by what it LACKS: no swing across the
  // body, no upward drive, no arc. Two subtleties: only travel TOWARD the
  // midline counts against it (outward extension is what a straight does), and
  // extension gain is not scored (hooks/uppercuts gain it too).
  const straightScore =
    (1 - Math.min(1, ratio(Math.max(0, f.inwardTravel), C.hookInwardTravel))) * 1.0 +
    (1 - Math.min(1, ratio(Math.max(0, f.upwardTravel), C.uppercutUpwardTravel))) *
      1.0 +
    (1 - Math.min(1, ratio(f.curvature - 1, C.curvedPathRatio - 1))) * 0.5;

  const role: "lead" | "rear" = side === leadHand(cal.stance) ? "lead" : "rear";

  type Family = "straight" | "hook" | "uppercut";
  const families: { key: Family; score: number }[] = [
    { key: "straight" as Family, score: straightScore },
    { key: "hook" as Family, score: hookScore },
    { key: "uppercut" as Family, score: uppercutScore },
  ].sort((a, b) => b.score - a.score);

  const winner = families[0];
  const runnerUp = families[1];
  const total = families.reduce((s, x) => s + Math.max(0, x.score), 0) || 1;
  const confidence = Math.max(
    0,
    Math.min(1, (winner.score - runnerUp.score) / total)
  );

  const type = punchTypeFor(winner.key, role);

  // Report scores per punch TYPE, mapping the straight family onto whichever
  // of jab/cross the stance implies, so the debug readout lines up with the
  // labels used in the confusion matrix.
  const scores: Record<PunchType, number> = {
    jab: role === "lead" ? straightScore : 0,
    cross: role === "rear" ? straightScore : 0,
    hook: hookScore,
    uppercut: uppercutScore,
  };

  return {
    type,
    family: PUNCH_FAMILY[type],
    hand: side,
    role,
    confidence,
    scores,
    features: f,
    timestamp,
  };
}

/** Normalized ratio of a value against a threshold, clamped at zero. */
function ratio(value: number, threshold: number): number {
  if (threshold <= 0) return 0;
  return Math.max(0, value / threshold);
}

/** Detects punches from both hands against a calibrated player. */
export class PunchClassifier {
  private diag = emptyDiagnostics();
  private left = new HandTracker("left", this.diag);
  private right = new HandTracker("right", this.diag);

  reset(): void {
    this.left.reset();
    this.right.reset();
  }

  /** Live detection diagnostics. See ClassifierDiagnostics for why. */
  get diagnostics(): ClassifierDiagnostics {
    return this.diag;
  }

  /** Clears diagnostics without disturbing in-flight tracking state. */
  resetDiagnostics(): void {
    const fresh = emptyDiagnostics();
    this.diag.launches = fresh.launches;
    this.diag.detections = fresh.detections;
    this.diag.rejections = fresh.rejections;
    this.diag.timeouts = fresh.timeouts;
    this.diag.byReason = fresh.byReason;
    this.diag.recent = fresh.recent;
    this.diag.peakSeen = fresh.peakSeen;
  }

  get debug(): Record<HandSide, HandDebugState> {
    return { left: this.left.debug, right: this.right.debug };
  }

  /** Returns any punches that completed on this frame. */
  update(pose: PoseFrame, cal: CalibrationData, now: number): PunchEvent[] {
    const events: PunchEvent[] = [];
    const l = this.left.update(pose, cal, now);
    if (l) events.push(l);
    const r = this.right.update(pose, cal, now);
    if (r) events.push(r);
    return events;
  }
}
