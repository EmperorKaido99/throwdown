// One-euro filter: adaptive low-pass that smooths jitter when the signal is
// slow but stays responsive (low latency) when it moves fast.
//
// Ported unchanged in principle from the Flap project's flap/smoothing.ts.
// 03-GESTURE-CLASSIFICATION.md requires smoothing before any trajectory work —
// both the heuristic classifier and (especially) a DTW comparison are sensitive
// to single-frame landmark jitter. The adaptive cutoff matters here: a fixed
// low-pass strong enough to kill resting jitter would also add lag to a real
// punch, and punch timing is the whole game.

import { POSE_KEYS, type PoseFrame } from "./poseTypes";
import { SMOOTHING_DEFAULTS } from "../config/tuning";

function alpha(cutoff: number, dt: number): number {
  const tau = 1 / (2 * Math.PI * cutoff);
  return 1 / (1 + tau / dt);
}

export class OneEuroFilter {
  private minCutoff: number;
  private beta: number;
  private dCutoff: number;
  private xPrev: number | null = null;
  private dxPrev = 0;
  private tPrev = 0;

  constructor(minCutoff = 1.2, beta = 0.02, dCutoff = 1.0) {
    this.minCutoff = minCutoff;
    this.beta = beta;
    this.dCutoff = dCutoff;
  }

  reset(): void {
    this.xPrev = null;
    this.dxPrev = 0;
    this.tPrev = 0;
  }

  /** Filter value x sampled at time t (ms). */
  filter(x: number, tMs: number): number {
    if (this.xPrev === null) {
      this.xPrev = x;
      this.tPrev = tMs;
      return x;
    }
    const dt = Math.max((tMs - this.tPrev) / 1000, 1e-3);
    this.tPrev = tMs;

    // Filtered derivative.
    const dx = (x - this.xPrev) / dt;
    const aD = alpha(this.dCutoff, dt);
    const dxHat = aD * dx + (1 - aD) * this.dxPrev;
    this.dxPrev = dxHat;

    // Adaptive cutoff rises with speed => less smoothing on fast motion.
    const cutoff = this.minCutoff + this.beta * Math.abs(dxHat);
    const aX = alpha(cutoff, dt);
    const xHat = aX * x + (1 - aX) * this.xPrev;
    this.xPrev = xHat;
    return xHat;
  }
}

/**
 * Applies a one-euro filter per landmark, per axis, producing a smoothed
 * PoseFrame. This sits between pose/ and perception/ exactly as described in
 * 01-ARCHITECTURE.md — the perception layer should never see raw landmarks.
 *
 * Confidence is passed through unfiltered; it's a quality signal, not a
 * trajectory, and smoothing it would blur the "landmark just became untracked"
 * edge that downstream gates rely on.
 */
export class PoseSmoother {
  private filters = new Map<string, OneEuroFilter>();
  private minCutoff: number;
  private beta: number;
  private dCutoff: number;

  constructor(
    minCutoff = SMOOTHING_DEFAULTS.minCutoff,
    beta = SMOOTHING_DEFAULTS.beta,
    dCutoff = SMOOTHING_DEFAULTS.dCutoff
  ) {
    this.minCutoff = minCutoff;
    this.beta = beta;
    this.dCutoff = dCutoff;
  }

  reset(): void {
    this.filters.clear();
  }

  private get(key: string): OneEuroFilter {
    let f = this.filters.get(key);
    if (!f) {
      f = new OneEuroFilter(this.minCutoff, this.beta, this.dCutoff);
      this.filters.set(key, f);
    }
    return f;
  }

  smooth(pose: PoseFrame): PoseFrame {
    const t = pose.timestamp;
    const out = { timestamp: t } as PoseFrame;
    for (const key of POSE_KEYS) {
      const kp = pose[key];
      out[key] = {
        x: this.get(`${key}.x`).filter(kp.x, t),
        y: this.get(`${key}.y`).filter(kp.y, t),
        z: kp.z === undefined ? undefined : this.get(`${key}.z`).filter(kp.z, t),
        confidence: kp.confidence,
      };
    }
    return out;
  }
}
