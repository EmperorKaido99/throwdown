# Tech Setup, Open Questions, and Risk Log

This file combines concrete setup guidance with a living log of assumptions and unknowns. Update the risk log section as work progresses — do not let assumptions silently become "facts" the team stops questioning.

## Reused from the Flap project (verify still current, don't assume)

- React + TypeScript + Vite scaffold.
- @mediapipe/tasks-vision for pose tracking, GPU delegate with CPU fallback, same landmark set (shoulders 11/12, elbows 13/14, wrists 15/16, plus head landmarks now also in active use).
- Three.js/WebGL2 rendering.
- License-clean stance: MediaPipe is Apache-2.0. Avoid AGPL-3.0 dependencies (e.g., Ultralytics YOLO-pose) unless a deliberate, documented decision is made to accept that tradeoff.

Before scaffolding, re-check current MediaPipe Tasks Vision documentation for model bundle URLs, exact API shape (FilesetResolver, PoseLandmarker.createFromOptions, running modes), and GPU delegate fallback behavior — the Flap project's setup notes are a starting point, not a guarantee that nothing has changed since.

## New dependencies for this project (verify current status before installing)

- A DTW (dynamic time warping) library for JS/TS, if Step 2's option B is pursued — search for actively maintained options rather than assuming a specific package name.
- A rollback-netcode-over-WebRTC library, if Milestone 6 is reached — investigate current options and their maintenance status rather than assuming any specific one from prior research is still the best choice by the time this milestone is reached.
- A minimal Node.js + WebSocket (or equivalent) package for the signaling server.
- STUN/TURN server access — a public STUN server for prototyping; a TURN provider or self-hosted TURN server only once Milestone 7 (internet play) is actually being built.

Do not install or write code against any of the above without first confirming the package/library is real, current, and matches the API assumed in these docs — this is exactly the kind of detail that can be hallucinated if not checked.

## Known pitfalls carried over from the Flap project

- Frame rate varies significantly by device/browser — test on real target hardware early, don't assume desktop-class numbers.
- Landmark jitter requires smoothing before feeding into any downstream logic (flap detection there, punch/dodge classification here).
- Webcam mirroring — keep video display and landmark coordinate handling consistent (don't mix a mirrored video element with un-mirrored landmark coordinates).
- HTTPS (or localhost) required for camera access — relevant for both local dev and eventual deployment/signaling server hosting.

## New pitfalls specific to this project

- Two-webcam testing is required, not optional. Punch classification and networking both need real validation with two actual players (or the same person on two devices/tabs), not just single-camera solo testing. Budget time and a second body/device for this.
- Symmetric NAT / strict firewall environments can prevent direct WebRTC connections even with STUN — this is why TURN exists, and why internet play (Milestone 7) is scoped separately from and after LAN play.
- Hardware asymmetry between two players (different laptops, different webcam quality, different lighting) is a real fairness variable in this project in a way it wasn't in the single-player Flap game — test with mismatched hardware, not just two similar machines.

## Open questions and risk log (update as the project progresses)

Use this section as a running log. Each entry should include what's unresolved, why it matters, and — once investigated — what was found. Do not delete resolved entries; mark them resolved with the finding, so the history of what was assumed vs. verified stays visible.

**1. Can punch types be reliably classified from a single frontal webcam?**
Status: **NOT ANSWERED BY THE FIRST MEASURED RUN — the run failed at the DETECTION stage, before classification was ever exercised.** (Run 1, 2026-07-22 ~22:15, dev laptop i5-7200U, ~15 FPS pose rate, 80 trials, 20 per type.)

```
Confusion matrix (rows = thrown, cols = detected):
                jab    cross     hook uppercut     none
jab               0        0        1        3       16
cross             0        0        3        0       17
hook              2        0        0        0       18
uppercut          0        0        1        5       14

type          n   recall     prec       F1
jab          20       0%       0%       0%
cross        20       0%       0%       0%
hook         20       0%       0%       0%
uppercut     20      25%      63%      36%

  FAIL  Detection rate           19%  (bar 90%)
  FAIL  Lead vs rear hand        67%  (bar 95%)
  FAIL  Straight vs curved       40%  (bar 85%)
  FAIL  4-way macro recall        6%  (bar 70%)
  FAIL  Worst class recall        0%  (bar 50%)
Macro F1: 9%     Mean pose samples per punch: 5.0
```

**Every bar failed, but the shape of the failure matters more than the numbers.** 81% of thrown punches produced no detection at all. `03-GESTURE-CLASSIFICATION.md` describes detection as the tractable half and classification as the open problem; this run failed the tractable half. The 19% that did register classified near-randomly, which is expected — a classifier fed a handful of barely-detected motions has nothing to work with.

**Therefore the A → B (DTW) escalation path does NOT apply yet.** DTW classifies punch trajectories; it cannot help with punches that are never detected. Escalating here would be solving a downstream problem and would waste the effort. This is explicitly NOT the "curved punches are hard to distinguish" outcome the plan anticipated.

**Frame rate has been ruled out as the cause.** Hypothesised because the run reported exactly 5.0 mean samples per punch, at the starvation threshold. Tested directly in `src/perception/frameRate.test.ts`, holding punch duration fixed and varying only sampling rate: detection succeeds at 30, 20, 15, 12 and 10 FPS on synthetic motion. Frame rate is not what broke this.

**Leading hypothesis: the detection gates are calibrated for motion that a toward-camera punch does not produce.** `synthetic.ts` warned about exactly this in its header — synthetic paths cannot reproduce foreshortening, so they exercise the gates with far larger 2D displacement than a real punch thrown at the lens generates. Specific suspects, in order:
- `launchExtension` (0.55 torso units of peak wrist-to-shoulder distance). A punch thrown along the optical axis barely separates the wrist from the shoulder in 2D. This was already lowered from 0.85 once for this reason and may still be too high.
- **Calibration measures `guardExtension` per hand and the classifier never uses it**, relying on the fixed `PERCEPTION_CONFIG.guardExtension` (0.7) instead. If a player's real guard sits outside that constant, the FSM never arms and no punch is ever launched. This is a genuine design defect, not just a mistuned number.
- `minExtensionGain` (0.18) and `minPeakSpeed` (1.2 torso-widths/s) are subject to the same foreshortening problem.

**Blocking gap: the harness records nothing about REJECTED punches.** Features are only produced for detections, so the 81% that failed are invisible — there is no way to tell which gate rejected them. Rejection-reason instrumentation is needed before any threshold is touched. Changing thresholds now would be guessing, and a threshold changed until a number improves is tuning-to-the-test, not a fix.

Do not record this as evidence about whether punch *types* are separable. That question remains genuinely unanswered.

Original context follows. The classifier (Approach A) and the guided measurement protocol are in place, and the bars were fixed in advance (open question 2). What remains is a person throwing ~20 labelled reps per punch type.

Design notes worth carrying forward:
- Nothing in `perception/` reads the z axis, per this document set's warning that depth is least reliable exactly where punches travel.
- All thresholds are torso-normalized, so tuning survives the player moving nearer or further from the camera.
- Torso scale prefers shoulder-to-hip distance but falls back to shoulder width when hips aren't visible. The fallback exists because a laptop webcam at desk height often frames head and torso only — requiring hips made calibration impossible in that setup. The fallback is less robust to a bladed boxing stance (apparent shoulder width shrinks as the player turns side-on), so the source used is recorded on each calibration and reported in the UI. Prefer a standing position where hips are visible for any run whose numbers will be recorded.

Original context follows. Prior research suggests straight punches (jab/cross) are more tractable than curved ones (hook/uppercut) thrown toward the camera; comparable published work reports strong overall accuracy but much weaker per-punch-type F1 in a similar single-camera frontal setup. Do not treat this as solved until Milestone 1 produces an actual measured confusion matrix.

**2. What punch-classification technique will actually be used (heuristic, DTW, or trained model)?**
Status: IN PROGRESS (2026-07-22) — Approach A (geometric + velocity heuristics with a per-hand guard-state FSM) is built and awaiting its first measured confusion matrix. Record the final choice and the measured accuracy that justified it here once decided.

**Accuracy bar, fixed BEFORE measuring** (per `CLAUDE.md`'s rule against upgrading assumptions into facts — a bar set after seeing results is not a bar):

| Criterion | Bar | Action if missed |
|---|---|---|
| Punch detected at all (vs. no-punch) | ≥90% recall, <1 false positive per 30 s of guard/idle | Fix detection before touching classification |
| Lead vs. rear hand | ≥95% | Near-free from which wrist moved; a miss indicates a landmark/stance bug |
| Straight vs. curved | ≥85% | Below 70% → escalate to Approach B (DTW) |
| Four-way macro recall | ≥70%, no single class below 50% | Descope to three-way, or a "swing" catch-all for curved punches |

The four-way bar is set at 70% rather than 90% deliberately: `03-GESTURE-CLASSIFICATION.md` records that comparable published work on a single frontal camera reached only ~49% per-punch F1, and that research above 90% relied on wearables or depth cameras. A 90% target here would be borrowed from non-comparable setups.

**10. (New, 2026-07-22) Two classifier bugs found by synthetic-trajectory tests, before any real data was collected.**
Status: RESOLVED — both fixed, regression tests in `src/perception/punchClassifier.test.ts`.

The measured Milestone 1 run was deferred, so the waiting time was spent testing the perception layer against synthetic, idealised punch trajectories (`src/perception/synthetic.ts`). This found bugs that would otherwise have been invisible until after a real session, and — worse — would have looked like *evidence that Approach A does not work*:

- **Extension gate was set for a side-on arm, not a toward-camera one.** `launchExtension` required peak wrist-to-shoulder distance of 0.85 torso units, close to a fully extended arm seen side-on. A punch thrown toward the camera foreshortens, so the wrist barely separates from the shoulder in 2D even at full extension. This gate would have rejected exactly the punches the game is built around. Lowered to 0.55 and re-cast as a sanity floor; rejection of non-punches now rests on extension *gain*, elbow opening and peak speed.
- **Straight-punch scoring conflated "hook" with "any lateral movement".** It used `|inwardTravel|`, penalising a straight punch for extending outward — which is what a straight punch does. Only travel toward the midline should count as hook-like, and only upward travel as uppercut-like. Separately, extension gain was being rewarded as evidence of straightness, but hooks and uppercuts gain extension too, so it inflated the straight score for every punch.

**What these tests do and do not prove.** They exercise noise-free, unambiguous motions, so they verify the plumbing — the FSM fires once per punch, never during idle guard, feature signs point the right way, and a clean example of each class lands in the right bucket. They prove **nothing** about real-world accuracy, because toward-camera foreshortening is precisely what synthetic paths cannot reproduce. Their value is narrow but real: they separate *"Approach A is defeated by the geometry"* (an expected, documented outcome that should trigger escalation to DTW) from *"Approach A has a sign error"* (a bug). Without them, a bad confusion matrix tonight would have been ambiguous between the two, and the likely conclusion would have been the wrong one.

Note the thresholds remain reasoned-from-geometry, not tuned. Nothing here was fitted to the synthetic data — both changes are justified by the geometry independently, which is why they are recorded as bug fixes rather than tuning.

**14. (New, 2026-07-22) Punch DETECTION redesigned after run 1's 19% detection rate. Five defects found, all before any second measured run.**
Status: REDESIGNED AND UNIT-TESTED. Still unvalidated against real punches.

The root cause of run 1 was that detection keyed on **wrist-to-shoulder distance** ("extension") and its rate of change. A punch thrown at the lens moves the fist toward the camera, so that 2D distance barely grows however hard the punch is thrown. The synthetic tests passed only because the synthetic paths never foreshortened — a limitation `synthetic.ts` documented in its own header and which then went on to bite exactly as warned.

**Fix 1 — model the real geometry.** Added a `straightForeshortened` synthetic shape: fist travels from cheek to in front of the face, a short, mostly-inward 2D displacement. Reproduced the failure immediately and quantifiably: peak extension 0.31 vs a 0.55 gate, extension gain 0.07 vs 0.18, peak speed 0.29 vs 1.2 — **three gates simultaneously unreachable**, not merely strict. A test that cannot fail on the real failure mode is worth very little; this one now can.

**Fix 2 — detect EXCURSION, not extension.** Detection now measures how far the fist has travelled from its own calibrated guard position, in torso units, regardless of direction. That has no blind axis, so one threshold serves straights, hooks and uppercuts. This also fixes the previously-recorded defect where calibration measured `guardExtension` and the classifier ignored it — calibration now records the guard **position vector** per hand, and detection is built on it.

**Fix 3 — a punch is the whole excursion EPISODE, not the first local peak.** Finalising on the first peak broke uppercuts: the chamber (fist dropping toward the ribs) is itself an excursion, so the punch finalised on the chamber, and the actual upward drive was then swallowed by the cooldown. The detected "punch" had an upward travel of 0.002 and was classified as a jab. Detection now runs from the fist leaving guard until it returns, taking the maximum excursion over that whole episode. Any punch with a wind-up has this shape, so it was never uppercut-specific.

**Fix 4 — gate on MEAN speed, not peak speed.** Peak speed is measured between consecutive frames, so a slower camera averages over a longer interval and systematically under-reports it. The same synthetic punch passed at 30 FPS and failed at 15 and 12 FPS (0.76 and 0.70 against a 0.8 gate) purely because of sampling rate. Distance over duration is sampling-invariant. This matters directly given the project targets a range of hardware and possibly phones.

**Fix 5 — thresholds partly derived from the player, not guessed.** Calibration now measures each fist's actual jitter while holding guard (90th-percentile distance from its median position). The punch threshold is the larger of a configured floor and a multiple of that jitter, so a shaky stance or noisy camera raises the bar automatically instead of producing phantom punches. This is the honest answer to "what should the number be?" while no real punch data exists.

Also fixed along the way: a **unit mismatch** where wrist speed was computed in raw image units while its threshold was documented in torso units, understating it roughly threefold; and `minPunchSamples` reduced from 3 to 2, since at 15 FPS a fast punch's outward travel spans barely two frames.

**Verification:** 53 unit tests pass, including all four punch shapes detecting exactly once at 30/20/15/12/10 FPS (20 combinations), no false positives across 120 idle-guard frames, two consecutive punches counted as two, a held extension never emitting, a slow reach rejected, a dropped-tracking frame never producing a short-window event, and jitter-scaled thresholds suppressing a punch for a shaky player.

**What this does NOT establish.** Detection has still never succeeded on a real thrown punch — every result above is synthetic. The thresholds remain reasoned rather than measured, and `minPunchExcursion` in particular is set against a modelled foreshortened punch (~0.16 torso units) that is itself an estimate. The detection diagnostics panel reports actual peaks reached, and those numbers should replace these estimates as soon as a real session produces them.

**13. (New, 2026-07-22) Milestone 2 — dodge/duck detection: BUILT, not yet validated with a real body.**
Status: IN PROGRESS. `src/perception/dodgeDetector.ts`, indicator in `src/ui/DodgeIndicator.tsx` (shown during free practice; synthetic preview at `?guides=1`). 25 unit tests pass.

Built ahead of Milestone 1's measurement deliberately: head-based dodging is required in **every** surviving scope, including the prior-art fallback where punch typing is dropped entirely and only "a punch was thrown" plus head position are used. So it cannot be invalidated by whatever Milestone 1 returns.

Design decisions worth carrying:
- Output is **continuous state, not discrete events**, per `03-GESTURE-CLASSIFICATION.md` — the simulation reads the opponent's head state at the moment a punch resolves, which discrete "dodged left" events would throw away.
- Everything is measured **relative to the current shoulder line**, normalized by torso scale. This is the central design point, not an optimisation: it is what stops a sidestep registering as a dodge, since the shoulders travel with the head. An absolute measure would false-trigger on every step, and Milestone 2 is explicitly judged on false triggers.
- Ducking is detected by **two** signals — head lowering toward the shoulders (a slip/bob), and the shoulder line itself dropping (a knee bend). Head-drop alone misses a crouch entirely, because a squat lowers head and shoulders together and leaves their relative distance unchanged. The whole-body signal has wider tolerances since it is measured against an absolute calibrated height and drifts as the player moves toward or away from the camera.
- On losing the nose landmark the detector **holds its last state** rather than snapping to neutral. Snapping upright mid-dodge would let the simulation score a hit the player had actually slipped.

**Still unvalidated:** Milestone 2's done-when is that dodging/ducking promptly moves the indicator with no noticeable false triggers from normal head movement. That needs a real body in front of the camera — including the boring cases (just looking around, natural sway, stepping) which are what the dead zones exist for. The dead-zone and full-range constants in `PERCEPTION_CONFIG` are reasoned, not tuned, and should be revisited during that session.

**11. (New, 2026-07-22) Two further bugs found by code review, before the measured run.**
Status: RESOLVED — both fixed.

- **Ring-buffer index off-by-one.** The trajectory history decremented its stored launch/peak indices whenever `history.length === historySize`, but that is also true on the frame the buffer first reaches capacity *without* dropping anything. The indices were therefore shifted one frame early, silently offsetting the feature window for the rest of that punch. Now keyed off whether a `shift()` actually occurred.
- **Punch subscription re-subscribed on every render.** The harness's `useEffect` depended on the `detection` object, whose identity changes each render, so it unsubscribed and resubscribed constantly; a punch landing in that gap would have been dropped and recorded as a miss. Now depends on the stable `onPunch` callback.

Neither would have thrown an error. Both would have shown up only as unexplained noise in the confusion matrix.

**12. (New, 2026-07-22) Measurement-validity aid: on-screen punch trajectory guides.**
Status: DONE — `src/ui/PunchGuide.tsx`, viewable standalone at `?guides=1`.

The confusion matrix compares the punch the player was *asked* for against the punch the classifier *reported*. If the player's idea of a hook differs from the classifier's, the matrix measures that disagreement rather than the classifier's ability — a validity problem, not a cosmetic one. Each prompt now shows a mirrored figure with the fist's travel path plus short form cues, and the four-punch reference appears during free practice.

The diagrams are mirrored to match the webcam preview so the lead hand appears on the same side in both, and they flip correctly with stance (verified for orthodox and southpaw). Straight punches draw a much larger dashed end marker: thrown at the lens the fist grows in frame rather than moving across it, which is the least intuitive thing to convey on a flat diagram and the most likely thing for a player to get wrong.

**Tooling note:** the diagnostic scripts in `tools/` previously hard-coded `localhost:5173`. The Flap project also runs on that port, so Shadow Box lands on 5174 when both are up and a diagnostic silently screenshotted the wrong application. All tools now honour `BASE_URL`. Related: do not use a broad `pkill -f vite` to restart the dev server — it will kill other projects' servers too.

**7b. (New, 2026-07-22) Is mobile a supported target?**
Status: OPEN — the project owner intends to test on mobile, which `02-IMPLEMENTATION-PLAN.md` previously listed as a v1 non-goal. Not yet committed. The classifier's geometric thresholds are calibrated against laptop-webcam framing; phone framing (portrait, closer, different FOV and camera height) would need its own calibration pass and its own measured confusion matrix. Do not assume laptop thresholds transfer.

**3. What is the real in-browser pose-tracking frame rate on target hardware, for two simultaneous local+remote pose streams?**
Status: PARTIALLY RESOLVED (2026-07-22, Milestone 0) — measured on the dev machine; **result is below the plan's 24–30 FPS floor**. Not yet measured across a range of hardware.

*Note on the question as originally posed:* it asks about "two simultaneous local+remote pose streams", but per `01-ARCHITECTURE.md` each client only ever tracks **its own** player — the remote player's actions arrive as classified discrete events, never as video or landmarks. So there is no second local pose stream to budget for. The relevant figure is single-stream, which is what was measured. The two-stream framing appears to be a leftover assumption; treat single-stream as the requirement unless the design changes.

**Machine measured** (dev laptop, a deliberately modest target):
- Intel Core i5-7200U @ 2.50GHz, 4 threads, 8 GB RAM
- Intel HD Graphics 620 (integrated), via ANGLE/D3D11, WebGL 2.0
- Chrome 150, Windows 10 Pro 19045
- `pose_landmarker_lite.task`, GPU delegate (confirmed engaged, no CPU fallback), `numPoses: 1`, segmentation masks off
- Real webcam, one person standing in frame; body detected in 100% of frames

**Measured, 30s steady-state run after a 6s warm-up (n=451 frames):**

| Metric | Value |
|---|---|
| Pose sample rate, median | **15.1 FPS** |
| Pose sample rate, mean | 15.0 FPS |
| Pose sample rate, worst 5% | **11.4 FPS** |
| Pose sample rate, best | 28.6 FPS |
| Frame interval, median | 66.2 ms |
| Inference cost (`detectForVideo`), median | **36.4 ms** |
| Inference cost, p95 | 42.5 ms |

**Diagnosis — this is a cliff edge, not a gentle shortfall.** The camera delivers frames every 33.3 ms (30 FPS, independently verified — see finding 8). Inference takes ~36 ms. Because inference overruns one camera frame period by only ~3 ms, every inference misses the next frame and the pipeline settles on **every second frame**: 66 ms intervals, exactly half of 30 FPS. The system is ~3 ms away from a step change back to ~30 FPS, not gradually degraded.

**Levers tested:**
- *Capture resolution:* **ruled out.** Dropping 640x480 → 320x240 moved inference only 36.4 ms → 34.0 ms and left the sample rate unchanged at 15.1 FPS. BlazePose rescales input to a fixed internal tensor, so capture resolution is close to irrelevant to inference cost. This invalidates "lower the capture resolution" as a fallback.
- *Lighter model:* already on `lite`, the lightest of the three MediaPipe bundles. No headroom in that direction.

**Web Worker lever: BUILT, and the early evidence is that it does NOT help.** The hypothesis was that main-thread inference cannot overlap frame delivery, so moving it off-thread would pipeline inference against capture and lift the ceiling to roughly 1000/36 ≈ 28 FPS. Implemented in `src/pose/poseWorker.ts`, selectable at runtime via `?worker=0|1`.

Result so far — **the hypothesis looks wrong**. In the one valid worker run (n=288, body detected in 99% of frames), the worker path measured **13.8 FPS median with inference at 52.5 ms**, versus 15.1 FPS / 36.4 ms for the main thread. Inference got *more* expensive off-thread, which is plausible on a 4-thread CPU where the worker competes with the main thread, and where the worker's GPU context and the extra `createImageBitmap` copy per frame both cost something.

**This is not yet a clean A/B and must not be recorded as settled.** The two numbers came from different sessions, and a confound was found in the process: **inference cost on this machine drifts substantially with background load** — the same main-thread code path measured 36.4 ms early on and 51.3 ms later the same session. Comparing runs taken minutes apart is therefore unsafe. `tools/ab-worker.mjs` now runs both conditions back-to-back with alternating order and refuses a verdict unless both conditions are valid; it needs a person standing in frame for the whole run, which an unattended run cannot guarantee.

**Open action:** run `npm run build && npm run preview`, then `npm run measure:ab` while standing in frame, and record the verdict here. Until then, treat "does the worker help?" as unresolved, leaning no.

Verify on a second, more modern machine before concluding the project is blocked: an i5-7200U with integrated HD 620 is a 2017 ultrabook and is likely a worst case rather than a typical target.

**4. Does delay-based netcode already feel fair on a real LAN, before rollback is added?**
Status: UNRESOLVED — to be measured in Milestone 5. If not, the fix is likely upstream (classification latency, simulation timing windows) rather than in the netcode layer itself.

**5. Does rollback netcode measurably improve feel over delay-based netcode for this specific game, given the "punch un-happens" wrinkle described in 04-NETWORKING-AND-NETCODE.md?**
Status: UNRESOLVED — to be measured in Milestone 6. Don't adopt rollback purely because it's the fighting-game-genre default; confirm it actually helps here.

**6. How much does hardware asymmetry between two players actually affect fairness in practice?**
Status: UNRESOLVED — flagged for Milestone 8 testing. If it's a real problem, capping effective input rate to the slower device is the leading mitigation idea, not yet validated.

**7. What is the actual, current state of the specific libraries referenced in 04-NETWORKING-AND-NETCODE.md (DTW libraries, rollback-netcode libraries, signaling-server helper libraries)?**
Status: PARTIALLY RESOLVED (2026-07-22) — only the base stack has been verified so far; DTW, rollback and signaling libraries remain unchecked and must not be assumed until their milestones are reached.

Verified at Milestone 0:
- `@mediapipe/tasks-vision` — latest published version is **0.10.35**, identical to the version the Flap project pins. No API drift from the working reference.
- `three` — latest is **0.185.1**, also identical to Flap's pin.
- API shape confirmed directly against `node_modules/@mediapipe/tasks-vision/vision.d.ts` rather than from memory: `PoseLandmarker.createFromOptions(WasmFileset, PoseLandmarkerOptions)`, the synchronous `detectForVideo(videoFrame, timestamp): PoseLandmarkerResult` overload, and `result.landmarks: NormalizedLandmark[][]` where each landmark is `{ x, y, z, visibility }`.
- WASM runtime and model bundle are served from `public/` rather than a CDN. The `public/mediapipe/wasm` files were diffed against `node_modules/@mediapipe/tasks-vision/wasm` and are byte-identical, so there is no npm-vs-CDN version-skew risk.

**8. (New, 2026-07-22) Measurement methodology: unattended browser runs can silently produce fake numbers.**
Status: RESOLVED — mitigations are in `tools/measure-pose.mjs`.

Three separate artifacts corrupted Milestone 0 measurements before the numbers stabilised, all of which would have been easy to report as real:
- **rAF/compositor throttling.** An occluded Chrome window stops compositing, and both `requestAnimationFrame` and `requestVideoFrameCallback` collapse to ~1 Hz. Several runs reported a confident "1.0 FPS" that was purely this. Note `document.visibilityState === "visible"` and `document.hasFocus() === true` were both reported during throttled runs, and the `--disable-backgrounding-occluded-windows` / `--disable-renderer-backgrounding` launch flags did **not** prevent it, so none of those are reliable guards. An in-page rAF keepalive loop helps but is **also not sufficient on its own** — throttled runs still occur when the Chrome window is behind other windows. **The only reliable condition found is the Chrome window genuinely being in the foreground and unobscured for the whole run.** Consequently the script does not try to guarantee validity; it *detects* invalidity, voiding any run whose median frame interval exceeds 500 ms. Treat a voided run as no data, and re-run with the window in front.
- **Which code path is being timed.** BlazePose runs an expensive whole-image detector while no body is acquired and a cheaper tracking path afterwards, so a run with nobody in frame times the wrong thing. The harness now reports the fraction of frames in which a body was found and warns below 50%.
- **Warm-up.** The first few seconds include WASM init and shader compilation. The harness discards 6 s before sampling.

Caveat on confidence: because of the throttling issue above, only **one** fully valid 30 s run was obtained (n=451). It is corroborated as described below, but a second clean run on a foregrounded window would be worth having before treating 15.1 FPS as settled.

Corroboration: the 15.1 FPS figure was reproduced by two independent methods — the in-app instrumentation, and an external probe (`tools/diag-app.mjs`) attached to the video element that knows nothing about the app's own counters. A separate probe (`tools/diag-camera.mjs`) confirmed the camera itself delivers 29.9 FPS and rAF runs at 59.9 FPS on this machine, which is what isolated inference as the bottleneck.

A fourth artifact emerged later: **machine load drift.** The same main-thread code path measured 36.4 ms and 51.3 ms for median inference within one session, as background load changed. Any A/B on this machine must therefore run its conditions back-to-back and alternate their order, not compare numbers captured minutes apart.

On forcing a valid run: no combination of Chrome launch flags reliably defeated the throttling — `--disable-background-timer-throttling`, `--disable-backgrounding-occluded-windows`, `--disable-renderer-backgrounding` and `--disable-features=CalculateNativeWinOcclusion` were all tried and all insufficient on their own. Repeatedly calling Playwright's `bringToFront()` during the run is the only thing that reliably worked. It steals focus for the duration, which is why measurement runs are intentionally short.

General lesson for later milestones: **any measurement taken from an unattended browser needs a validity check reported alongside the number**, otherwise a throttled or mis-pathed run is indistinguishable from a real result. This applies directly to the network-latency measurements in Milestones 4–6.

**9. (New, 2026-07-22) MediaPipe cannot load inside a Vite dev-server module worker.**
Status: RESOLVED — worked around; constrains how the worker path is tested.

Two distinct failures surfaced when moving inference into a worker, both worth knowing before anyone tries this again:
- **Vite dev returns 500 for the WASM glue.** `FilesetResolver` dynamically imports `vision_wasm_internal.js` at runtime. When that import originates in a module worker, Vite's dev server appends `?import` to the request, and for a static file under `public/` that makes Vite try to resolve it as a module-graph entry — HTTP 500, "Failed to load url". Worked around with a small dev-only middleware in `vite.config.ts` that strips the query for `/mediapipe/wasm/`. Production builds are unaffected.
- **MediaPipe needs a *classic* worker, not a module worker.** After the above, init failed with "ModuleFactory not set". MediaPipe loads its glue via `importScripts()`, which does not exist in module workers; loading the glue as an ES module instead leaves its top-level factory `var` module-scoped rather than global, so MediaPipe can't find it. Fixed with `worker: { format: "iife" }` in `vite.config.ts` plus Vite's `?worker` import form.

**Consequence for testing:** `worker.format` applies only to builds — Vite's dev server always serves module workers. So **the worker path cannot run under `npm run dev` at all**; it must be exercised against `npm run build && npm run preview`. Any future measurement of the worker path has to use the preview server.

## Instruction for whoever (or whatever) is executing this plan

When any of the above is investigated and resolved, update its status and findings in place rather than just proceeding silently — this file is meant to make the project's actual state of knowledge visible at a glance, not to be a one-time planning artifact that goes stale.
