# Shadow Box — Handover / Memory

A single-file orientation for anyone (human or agent) picking this project up. It
explains what the project is, how it is put together, how the hard part works,
and exactly where things stand. For the authoritative, evolving detail, follow
the pointers into `docs/` and `CLAUDE.md`.

---

## 1. What this is

**Shadow Box** is a 1v1 webcam pose-tracking boxing game. Two players stand in
front of their webcams; the browser tracks each player's body pose in real time
and turns it into gameplay:

- **Head movement → defence.** Leaning left/right is a dodge; lowering the head
  or crouching is a duck.
- **Arm movement → offence.** A thrown punch is detected and classified into one
  of four types — **jab, cross, hook, uppercut**.
- **Hits resolve peer-to-peer** between the two players over WebRTC (planned,
  not yet built).

Everything runs **client-side in the browser**. Pose tracking never leaves the
machine. When networking lands, only small discrete events (e.g.
`{ type: "cross", hand: "rear", frame: 1234 }`) cross the wire — never video and
never raw landmarks.

It is a follow-on from an earlier single-player webcam game ("Flap"), reusing
that stack (React + TypeScript + Vite + Three.js + MediaPipe) but adding two
genuinely hard new problems: **multi-class punch classification from one frontal
camera**, and **real-time P2P netcode**.

## 2. The core risk (read this before touching perception)

The make-or-break question of the whole project is:

> Can punch *types* be reliably classified from a single 2D frontal webcam?

Straight punches (jab/cross) are tractable. Curved punches (hook/uppercut) are
thrown **toward the camera**, so they are foreshortened along exactly the axis
that would tell them apart from a straight punch — comparable research has
measured only ~49% per-punch F1 on similar setups. This is why the project is
staged **risk-first**: the punch classifier is prototyped and *measured* in
isolation before any networking or polish is written. No library does 4-way
punch classification out of the box; that layer is built and validated here.

**Rule:** don't report a milestone "done" from expected numbers. Its "done-when"
criteria are measurements — record the real numbers in
`docs/05-TECH-SETUP-AND-RISK-LOG.md`.

## 3. Stack

| Layer | Choice |
|---|---|
| UI / build | React 19, TypeScript, Vite 8 |
| Rendering | Three.js (WebGL2) — minimal so far |
| Pose tracking | `@mediapipe/tasks-vision` `PoseLandmarker`, GPU delegate + CPU fallback, 33 BlazePose landmarks. Model + WASM served from `public/`, not a CDN. |
| Tests | Vitest (perception logic against synthetic trajectories) |
| Lint | oxlint |

License-clean by decision: MediaPipe is Apache-2.0. Do **not** add AGPL-3.0
dependencies (e.g. Ultralytics YOLO-pose) without a deliberate, documented call.

## 4. How the code is organised

Strict module boundaries from day one (`src/`):

```
capture/     getUserMedia — the raw webcam stream
pose/        MediaPipe inference, internal landmark types, one-euro smoothing
perception/  calibration, punch detection FSM, punch classification, dodge/duck
config/      ALL tunable constants (tuning.ts) — no magic numbers in logic
debug/       rolling perf stats, confusion-matrix scoring
ui/          debug overlay, HUD, punch harness, trajectory guides, dodge indicator
```

Data flows one way: **capture → pose → perception → (future) simulation →
render**. Layers talk through typed handles, never by reaching into each other.

### The perception pipeline (the interesting part)

1. **Calibration** (`perception/calibration.ts`). The player holds a guard for
   ~30 frames. This captures a **torso scale** (shoulder-to-hip distance, or
   shoulder width when hips are out of frame), the resting **guard position** of
   each fist, the **guard jitter** (how much each fist wanders at rest), the
   **stance** (orthodox/southpaw — captured, not inferred, to avoid the
   unreliable z axis), and a **neutral head** reference.

2. **Everything is torso-normalized.** `1.0` = one torso length, so the same
   thresholds hold whether the player is near/far, tall/short. No threshold is
   in raw pixels.

3. **No z is ever used.** Punches travel toward the lens, exactly where
   MediaPipe's depth estimate is worst. Classification is built on the x/y
   trajectory, velocity and timing only.

4. **Punch detection** (`perception/punchClassifier.ts`, per-hand FSM). The key
   idea, after the first measured run failed: detection keys on **excursion** —
   how far the fist has travelled from its calibrated guard position, in any
   direction — not on wrist-to-shoulder "extension" (which barely grows for a
   punch thrown at the camera). A punch is the *whole excursion episode* from
   leaving guard to returning, not the first local peak (so an uppercut's
   chamber doesn't get mistaken for the punch). Gates: excursion floor
   (self-scaling with guard jitter), **mean** outward speed (mean, not peak, so
   it's frame-rate invariant), duration ceiling, minimum sample count, cooldown.

5. **Punch classification.** Simple, additive, inspectable scores for three
   motion families (straight / hook / uppercut) from geometric features
   (inward travel, upward travel from lowest point, path curvature), then mapped
   to jab/cross/hook/uppercut using the calibrated stance. Deliberately
   transparent so a misclassification can be read straight off the per-type
   scores — Approach A exists to be diagnosed, then kept or replaced.

6. **Dodge/duck** (`perception/dodgeDetector.ts`, Milestone 2). Continuous head
   state relative to the *current shoulder line*, so a plain sidestep (shoulders
   moving with the head) does not read as a dodge. Duck is detected two ways —
   head lowering toward the shoulders, and a whole-body crouch — because a squat
   lowers both together.

## 5. Current status (as of handover)

| Milestone | State |
|---|---|
| **M0 — pose scaffold** | Built + measured. **15.1 FPS median** on the dev laptop, below the 24–30 FPS bar. Deferred by the owner: faster hardware and mobile will be tested. A Web Worker inference path exists (`?worker=1`) but did not help. |
| **M1 — punch classification** | Built. **Run 1 failed at the detection stage** (19% detection, all bars failed) — this was *not* the expected hook/uppercut confusion; punches were never detected. Detection was then **completely redesigned** (excursion-based, episode-based, mean-speed, jitter-scaled). 53 unit tests pass, incl. all four punch shapes at 10–30 FPS. **Not yet validated on real thrown punches — run 2 is required.** |
| **M2 — dodge/duck** | Built, not yet validated with a real body. |
| **Networking** | Not started. Do not start it before M1 clears its bar. |
| **Avatar** | Scope agreed (first-person gloves + stylised opponent) but not built — deferred until the punch set is settled by M1. |

**The open question that still matters most:** whether punch *types* are
separable at all from this camera angle is genuinely unanswered. The detection
redesign only fixes "was a punch thrown?"; it says nothing yet about "which
punch?".

## 6. How to run it

```bash
npm install
npm run dev          # http://localhost:5174  (pinned to 5174, not 5173)
```

Open the URL, click **Enable camera** (needs localhost or HTTPS). The app opens
on the **Milestone 1 — punches** panel:

1. Stand back so hips, hands and head are all in frame (a seated desk pose fails
   calibration — wrists drop out of frame).
2. Pick stance, hold guard while it samples ~30 frames.
3. **Free practice** to sanity-check labels and watch the dodge indicator.
4. **Start measured run** for the hands-free protocol that produces a confusion
   matrix scored against pre-set bars.

Other scripts: `npm run build` (typecheck + build), `npm run lint`,
`npm test` (Vitest). Measurement tools live in `tools/` and honour `BASE_URL`
(default `http://localhost:5174`); see the README.

**Diagnosing a failed detection run:** Free Practice shows a **detection
diagnostics** panel. Its "peak seen" row reports the highest value each signal
actually reached — if a peak sits below its gate, the gate is *unreachable* for
that player, not merely strict, and that's the number to act on.

## 7. Working agreement (carry these forward)

- Don't fabricate library APIs — verify against current docs before coding.
- Don't upgrade an assumption into a fact; measurements go in the risk log with
  real numbers.
- Follow the risk-first order: no networking/polish before M1 is measured and
  passing. If M1 fails even after the fallback approaches in
  `docs/03-GESTURE-CLASSIFICATION.md` (A → DTW → small trained model), **stop and
  rescope with the owner** rather than lowering the bar.
- Keep the module boundaries above intact.
- All tunable numbers live in `config/tuning.ts` and are reasoned from geometry,
  not yet tuned against data — expect to revise them once a confusion matrix
  exists.

## 8. Where to read more

1. `CLAUDE.md` — living status and non-negotiables (read first).
2. `docs/01-ARCHITECTURE.md` — layers, what's reused from Flap, what's new.
3. `docs/02-IMPLEMENTATION-PLAN.md` — the risk-first milestone order.
4. `docs/03-GESTURE-CLASSIFICATION.md` — the hard problem, in depth.
5. `docs/04-NETWORKING-AND-NETCODE.md` — WebRTC + netcode plan (not yet built).
6. `docs/05-TECH-SETUP-AND-RISK-LOG.md` — setup, pitfalls, and the living log of
   open questions and measured results. **Update this in place as work happens.**
