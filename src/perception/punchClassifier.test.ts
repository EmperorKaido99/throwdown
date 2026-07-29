import { describe, expect, it } from "vitest";
import { PunchClassifier } from "./punchClassifier";
import { syntheticIdle, syntheticPunch, SYNTHETIC_TORSO_SCALE } from "./synthetic";
import { TEST_CALIBRATION as CAL } from "./testCalibration";
import { angleDeg } from "./geometry";
import { torsoScaleOf } from "../pose/poseTypes";
import type { PunchEvent } from "./punchTypes";
import { PERCEPTION_CONFIG } from "../config/tuning";
import { blockIntro, handFor, repCue } from "./punchScript";
import { PUNCH_TYPES } from "../debug/confusionMatrix";

// These tests check the perception layer's PLUMBING against idealised motion.
// They deliberately do not claim anything about real-world accuracy — see the
// header of synthetic.ts for why that distinction matters here.


function run(frames: ReturnType<typeof syntheticPunch>): PunchEvent[] {
  const c = new PunchClassifier();
  const events: PunchEvent[] = [];
  for (const f of frames) {
    events.push(...c.update(f, CAL, f.timestamp));
  }
  return events;
}

describe("geometry", () => {
  it("measures a straight arm as ~180 degrees", () => {
    expect(angleDeg({ x: 0, y: 0 }, { x: 1, y: 0 }, { x: 2, y: 0 })).toBeCloseTo(180, 1);
  });

  it("measures a right-angled bend as ~90 degrees", () => {
    expect(angleDeg({ x: 0, y: 0 }, { x: 1, y: 0 }, { x: 1, y: 1 })).toBeCloseTo(90, 1);
  });
});

describe("torso scale", () => {
  it("prefers shoulder-hip distance when hips are visible", () => {
    const [frame] = syntheticPunch("straight", { hand: "left", frames: 2 });
    const s = torsoScaleOf(frame, 0.5);
    expect(s?.source).toBe("shoulder-hip");
    expect(s?.value).toBeCloseTo(SYNTHETIC_TORSO_SCALE, 3);
  });

  it("falls back to shoulder width when hips are not tracked", () => {
    const [frame] = syntheticPunch("straight", { hand: "left", frames: 2 });
    const noHips = {
      ...frame,
      leftHip: { ...frame.leftHip, confidence: 0 },
      rightHip: { ...frame.rightHip, confidence: 0 },
    };
    const s = torsoScaleOf(noHips, 0.5);
    expect(s?.source).toBe("shoulder-width");
    expect(s?.value).toBeGreaterThan(0);
  });
});

describe("punch detection", () => {
  it("detects exactly one punch per thrown punch", () => {
    const events = run(syntheticPunch("straight", { hand: "left" }));
    expect(events).toHaveLength(1);
  });

  it("does not fire while the player just holds guard", () => {
    const c = new PunchClassifier();
    const events: PunchEvent[] = [];
    for (const f of syntheticIdle(120)) {
      events.push(...c.update(f, CAL, f.timestamp));
    }
    expect(events).toHaveLength(0);
  });

  it("attributes the punch to the hand that actually moved", () => {
    expect(run(syntheticPunch("straight", { hand: "left" }))[0].hand).toBe("left");
    expect(run(syntheticPunch("straight", { hand: "right" }))[0].hand).toBe("right");
  });

  it("maps hand to lead/rear using the calibrated stance", () => {
    // Orthodox: left leads, so a left straight is a jab and a right a cross.
    expect(run(syntheticPunch("straight", { hand: "left" }))[0].type).toBe("jab");
    expect(run(syntheticPunch("straight", { hand: "right" }))[0].type).toBe("cross");
  });
});

describe("feature signs", () => {
  // A sign error here would invert a whole class and is the single most likely
  // way to waste a real measurement session, so it is asserted directly rather
  // than inferred from the resulting label.
  it("reports inward travel as positive for a hook with either hand", () => {
    for (const hand of ["left", "right"] as const) {
      const e = run(syntheticPunch("hook", { hand }))[0];
      expect(e, `${hand} hook produced no event`).toBeDefined();
      expect(e.features.inwardTravel).toBeGreaterThan(0);
    }
  });

  it("reports upward travel as positive for an uppercut with either hand", () => {
    for (const hand of ["left", "right"] as const) {
      const e = run(syntheticPunch("uppercut", { hand }))[0];
      expect(e, `${hand} uppercut produced no event`).toBeDefined();
      expect(e.features.upwardTravel).toBeGreaterThan(0);
    }
  });

  it("reports an uppercut as dropping below the shoulder line to chamber", () => {
    const e = run(syntheticPunch("uppercut", { hand: "right" }))[0];
    expect(e, "uppercut produced no event").toBeDefined();
    expect(e.features.lowestHeight).toBeLessThan(0);
  });

  it("reports a straight punch as NOT dropping as low as an uppercut", () => {
    const straight = run(syntheticPunch("straight", { hand: "left" }))[0];
    const uppercut = run(syntheticPunch("uppercut", { hand: "left" }))[0];
    expect(uppercut.features.lowestHeight).toBeLessThan(
      straight.features.lowestHeight
    );
  });

  it("reports a straight punch as less curved than a hook", () => {
    const straight = run(syntheticPunch("straight", { hand: "left" }))[0];
    const hook = run(syntheticPunch("hook", { hand: "left" }))[0];
    expect(hook.features.curvature).toBeGreaterThan(straight.features.curvature);
  });

  it("reports the elbow opening over the punch", () => {
    const e = run(syntheticPunch("straight", { hand: "left" }))[0];
    expect(e.features.elbowAnglePeak).toBeGreaterThan(e.features.elbowAngleStart);
  });
});

describe("classification of idealised motion", () => {
  // If these fail, Approach A has a bug. If these pass but a real measured run
  // fails, that is the documented frontal-camera limitation rather than a
  // defect — the distinction this whole file exists to make.
  it("classifies an unambiguous hook as a hook", () => {
    for (const hand of ["left", "right"] as const) {
      expect(run(syntheticPunch("hook", { hand }))[0].type).toBe("hook");
    }
  });

  it("classifies an unambiguous uppercut as an uppercut", () => {
    for (const hand of ["left", "right"] as const) {
      expect(run(syntheticPunch("uppercut", { hand }))[0].type).toBe("uppercut");
    }
  });

  it("classifies an unambiguous straight punch as straight-family", () => {
    for (const hand of ["left", "right"] as const) {
      expect(run(syntheticPunch("straight", { hand }))[0].family).toBe("straight");
    }
  });
});

describe("detection robustness", () => {
  // The episode-based design finalises when the fist returns to guard, so the
  // obvious risks are merging consecutive punches and never finalising at all.

  it("counts two consecutive punches as two events", () => {
    const c = new PunchClassifier();
    const events: PunchEvent[] = [];
    let t = 0;
    for (let rep = 0; rep < 2; rep++) {
      for (const f of syntheticPunch("straightForeshortened", { hand: "left" })) {
        // Re-base timestamps so the second punch follows the first.
        const shifted = { ...f, timestamp: f.timestamp + t };
        events.push(...c.update(shifted, CAL, shifted.timestamp));
      }
      t += 2000;
    }
    expect(events).toHaveLength(2);
  });

  it("does not emit while the hand stays extended and never returns", () => {
    const c = new PunchClassifier();
    const frames = syntheticPunch("straight", { hand: "left" });
    // Feed only the outward half, then hold the final frame indefinitely.
    const outward = frames.slice(0, Math.floor(frames.length / 2));
    const events: PunchEvent[] = [];
    for (const f of outward) events.push(...c.update(f, CAL, f.timestamp));

    const last = outward[outward.length - 1];
    for (let i = 1; i <= 60; i++) {
      const held = { ...last, timestamp: last.timestamp + i * 33 };
      events.push(...c.update(held, CAL, held.timestamp));
    }
    expect(events).toHaveLength(0);
  });

  it("rejects a slow reach rather than calling it a punch", () => {
    // Same path, but taken far too slowly to be a punch.
    const c = new PunchClassifier();
    const events: PunchEvent[] = [];
    for (const f of syntheticPunch("straight", {
      hand: "left",
      frames: 30,
      frameIntervalMs: 40,
    })) {
      events.push(...c.update(f, CAL, f.timestamp));
    }
    expect(events).toHaveLength(0);
  });

  it("tolerates a dropped-tracking frame mid-punch without emitting garbage", () => {
    const c = new PunchClassifier();
    const frames = syntheticPunch("hook", { hand: "left" });
    const events: PunchEvent[] = [];
    frames.forEach((f, i) => {
      const dropped =
        i === Math.floor(frames.length / 2)
          ? { ...f, leftWrist: { ...f.leftWrist, confidence: 0 } }
          : f;
      events.push(...c.update(dropped, CAL, dropped.timestamp));
    });
    // Either it recovers and reports a punch, or it discards it — but it must
    // never report one built from a trajectory with a hole in it.
    for (const e of events) {
      expect(e.features.sampleCount).toBeGreaterThanOrEqual(
        PERCEPTION_CONFIG.minPunchSamples
      );
    }
  });

  it("scales thresholds with measured guard jitter", () => {
    // A player whose guard wanders should need a bigger motion to register,
    // otherwise their jitter reads as a stream of phantom punches.
    const jittery = {
      ...CAL,
      guardJitter: { left: 0.2, right: 0.2 },
    };
    const c = new PunchClassifier();
    const events: PunchEvent[] = [];
    for (const f of syntheticPunch("straightForeshortened", { hand: "left" })) {
      events.push(...c.update(f, jittery, f.timestamp));
    }
    // 0.2 * 3 = 0.6 required, well above this punch's ~0.17 excursion.
    expect(events).toHaveLength(0);
  });
});

// Reproduces the phone run of 2026-07-29: 39 prompted punches produced
// 29 launches, 27 rejections all reading "excursion <", and 0 detections —
// while the peak excursion actually SEEN reached 1.54 against a 0.13 gate.
// A gate cleared twelve times over cannot also be the thing rejecting every
// punch, so the episode being measured is not the punch.
describe("detection episode boundaries (regression: 2026-07-29 phone run)", () => {
  it("does not launch or reject on idle guard jitter", () => {
    const c = new PunchClassifier();
    for (const f of syntheticIdle(120)) c.update(f, CAL, f.timestamp);
    const d = c.diagnostics;

    // Standing in guard is not a punch attempt. Counting it as one floods the
    // rejection log with the gate the real punch is later blamed on.
    expect(d.launches).toBe(0);
    expect(d.rejections).toBe(0);
  });

  it("does not finalise a punch before the fist has left the guard radius", () => {
    // A real punch accelerates from rest, so its first sampled frame can still
    // sit inside the guard radius — especially at the ~15 FPS these devices
    // actually run at. Finalising there measures the first two frames of the
    // wind-up and reports a near-zero excursion.
    const c = new PunchClassifier();
    for (const f of syntheticPunch("straightForeshortened", { hand: "left", frames: 8 })) {
      c.update(f, CAL, f.timestamp);
    }
    const d = c.diagnostics;
    const worst = d.recent[d.recent.length - 1];

    expect(
      worst === undefined || worst.peakExcursion >= d.peakSeen.left.excursion * 0.5,
      `an episode was finalised at excursion ${worst?.peakExcursion.toFixed(3)} ` +
        `while the fist reached ${d.peakSeen.left.excursion.toFixed(3)} — ` +
        `the episode ended before the punch did`
    ).toBe(true);
  });
});

// The spoken prompt is now the primary instruction — the player is too far away
// to read the screen. If it names the wrong hand, the player throws the wrong
// hand and the confusion matrix records a classifier error that never happened.
describe("spoken prompt script", () => {
  it("maps punch type and stance to the correct physical hand", () => {
    expect(handFor("jab", "orthodox")).toBe("left");
    expect(handFor("hook", "orthodox")).toBe("left");
    expect(handFor("cross", "orthodox")).toBe("right");
    expect(handFor("uppercut", "orthodox")).toBe("right");

    // Southpaw mirrors every one of them.
    expect(handFor("jab", "southpaw")).toBe("right");
    expect(handFor("hook", "southpaw")).toBe("right");
    expect(handFor("cross", "southpaw")).toBe("left");
    expect(handFor("uppercut", "southpaw")).toBe("left");
  });

  it("names the hand in every per-rep cue", () => {
    for (const stance of ["orthodox", "southpaw"] as const) {
      for (const type of PUNCH_TYPES) {
        const cue = repCue(type, stance);
        expect(cue).toContain(type);
        expect(cue).toContain(handFor(type, stance));
      }
    }
  });

  it("calls out a hand switch only when the hand actually changes", () => {
    // jab (lead) -> cross (rear) switches hands; jab -> hook does not.
    expect(blockIntro("cross", "orthodox", 20, "jab")).toContain("Switch hands");
    expect(blockIntro("hook", "orthodox", 20, "jab")).not.toContain("Switch hands");
    // The first block has nothing to switch from.
    expect(blockIntro("jab", "orthodox", 20, null)).not.toContain("Switch hands");
  });
});

// Reproduces the phone run of 2026-07-29 14:33 (build 8525a1b), 80 trials,
// 1/80 detected. The rejection log read "excursion 0.90 < 1.28" — but the
// configured floor is 0.13. The gate had been inflated tenfold by the
// jitter-scaling in risk log 14 fix 5, which has no upper bound: the player
// stood far enough back that torso scale halved (0.243 vs 0.536), landmark
// noise became a large fraction of body size, and the measured guard jitter
// went to ~0.4 torso units.
describe("jitter-scaled gates (regression: 2026-07-29 far-framing run)", () => {
  const NOISY = {
    ...CAL,
    // Measured on the device: minExcursion showed as 1.28 = jitter x 3.
    guardJitter: { left: 0.4267, right: 0.36 },
  };

  it("does not let measured jitter raise the punch gate above a real punch", () => {
    const c = new PunchClassifier();
    for (const f of syntheticPunch("straight", { hand: "left" })) {
      c.update(f, NOISY, f.timestamp);
    }
    const d = c.diagnostics;
    expect(
      d.detections,
      `a clean synthetic punch was not detected under a noisy calibration; ` +
        `rejections: ${JSON.stringify(d.byReason)}`
    ).toBe(1);
  });

  it("still adapts the gate upward for mildly noisy tracking", () => {
    // The adaptation is worth keeping — it is what stops a shaky stance
    // producing phantom punches. Only its unbounded growth is the bug.
    const mild = { ...CAL, guardJitter: { left: 0.05, right: 0.05 } };
    const c = new PunchClassifier();
    for (const f of syntheticIdle(120)) c.update(f, mild, f.timestamp);
    expect(c.diagnostics.detections).toBe(0);
  });
});
