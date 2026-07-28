# Features

Status here reflects **measured reality**, not intent. A feature that is coded
but unmeasured is "Built, unvalidated" — never "Done". See `CLAUDE.md`.

## Active Features

| Feature | Description | Status |
|---------|-------------|--------|
| Webcam capture | `getUserMedia`, readiness/error states, resolution reporting | ✅ Working |
| Client-side pose tracking | MediaPipe `PoseLandmarker` (lite), GPU delegate confirmed engaged | ✅ Working — but 15.1 FPS median on the dev laptop, below the 24–30 FPS plan floor |
| Debug landmark overlay | Smoothed skeleton, optional raw/unsmoothed overlay | ✅ Working |
| Frame-rate instrumentation | Median/p95 frame interval and inference cost, validity checks for throttled runs | ✅ Working |
| Web Worker inference path | `?worker=1`, build-only | ⚠️ Built; early evidence says it does not help (13.8 vs 15.1 FPS). A/B not settled |
| Per-player calibration | Guard position vector per hand, guard jitter, torso scale, stance | ✅ Built, exercised only in dev |
| Punch detection | Excursion-from-guard episode detection, mean-speed gate, jitter-scaled thresholds | ⚠️ **Built, never validated on a real thrown punch.** Redesigned after run 1's 19% detection rate |
| Punch classification (4-way) | Geometric + velocity heuristics (Approach A) | ⚠️ Built; accuracy unknown — the only measured run never reached the classifier |
| Head dodge/duck detection | Continuous lean/duck relative to the shoulder line | ⚠️ Built, 25 unit tests, never validated with a real body |
| Punch trajectory guides | Mirrored reference diagrams, stance-aware | ✅ Working |
| Guided measurement protocol | Hands-free labelled protocol producing a confusion matrix against pre-set bars | ✅ Working — needs a human to run it |
| UI shell + main menu | Screen routing, mobile-responsive layout, persisted settings | ✅ Working |

## Not Built

| Feature | Blocked by |
|---------|-----------|
| Fight simulation (health, hit resolution, rounds) | Milestone 1 measurement (SB-001) |
| Avatar / first-person gloves / pro-boxer punch animation | Milestone 1 — the surviving punch set determines the animation set |
| Signaling server, WebRTC data channel | Risk-first order |
| Delay-based netcode, then rollback | Risk-first order |
| Internet play (TURN) | Explicitly after LAN play is validated |
| Mobile support | Undecided (risk log 7b) — needs its own calibration and confusion matrix |
