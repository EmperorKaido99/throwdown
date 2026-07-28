# Project: Shadow Box — Webcam Pose-Tracking Multiplayer Boxing Game

> This file is read automatically by Claude Code at session start. Keep it up to date as decisions change. Companion docs live in `docs/`. Read them in the order listed below, when the relevant phase begins — don't load all of them into context at once.

## What this project is

A 1v1 shadow-boxing game where two players' webcams track their body pose in real time. Head movement controls dodging/ducking; arm movement is classified into punch types (jab, cross, hook, uppercut) and resolved as hits between two players over a network (LAN or internet).

This is a follow-on project from an earlier single-player webcam game ("Flap" — flap your arms to fly), which established the base stack: React + TypeScript + Three.js/WebGL2, MediaPipe Tasks Vision for pose tracking, fully client-side, no Python. This project keeps that stack but adds two genuinely hard new problems on top of it:

1. **Multi-class gesture classification** (distinguishing punch types from a single frontal webcam) — harder than the flap game's simple threshold detector.
2. **Real-time multiplayer networking** (WebRTC data channels, a signaling server, and fighting-game-style netcode) — entirely new to this project.

## Read this before writing any code

This project carries real, unresolved technical risk that the earlier flap game did not have. Specifically:

- It is not yet proven that punch types (especially hooks and uppercuts, thrown toward a camera) can be reliably classified from a single 2D webcam. Prior art (see `docs/01-ARCHITECTURE.md` and `docs/03-GESTURE-CLASSIFICATION.md`) shows straight punches are tractable; curved punches toward-camera are a known hard problem, and one comparable research paper measured only ~49% per-punch F1 on a similar setup.
- Do not assume this problem is solved or that a given library "just does" 4-way punch classification out of the box — none of the libraries in this stack (MediaPipe Pose, MediaPipe Hands) provide punch-type classification directly. That layer must be built and validated by this project.
- Because of this, the project is explicitly staged so the riskiest, most uncertain part (punch classification) is prototyped and validated first, in isolation, before any networking or multiplayer code is written. See `docs/02-IMPLEMENTATION-PLAN.md` — do not skip ahead to networking or polish before Milestone 1 (offline punch classification prototype) has been validated against real measurements, not assumptions.

## Document map

Read in this order as the project progresses:

1. **`docs/01-ARCHITECTURE.md`** — layered architecture, what's reused from the Flap project, what's new, and why. Read this first, always.
2. **`docs/02-IMPLEMENTATION-PLAN.md`** — staged build plan in explicit risk-first order. Read the current stage before starting work; do not jump ahead to later stages.
3. **`docs/03-GESTURE-CLASSIFICATION.md`** — the hardest technical problem in this project: detecting punches and classifying their type from pose landmarks, plus head-based dodge/duck detection. Read before writing any perception-layer code.
4. **`docs/04-NETWORKING-AND-NETCODE.md`** — WebRTC data channels, signaling server, rollback netcode, what data to sync and why. Read before writing any multiplayer/networking code.
5. **`docs/05-TECH-SETUP-AND-RISK-LOG.md`** — concrete packages, install commands, known pitfalls, and a living log of unresolved questions and assumptions. Update the risk-log section as work progresses — do not let assumptions silently become "facts."

## Non-negotiable technical decisions (don't re-litigate without a strong reason)

- **Pose tracking runs entirely client-side in the browser**, same as the Flap project: `@mediapipe/tasks-vision` `PoseLandmarker`, GPU delegate with a CPU fallback.
- **Gameplay logic (hit resolution, health, timing) stays client-side, peer-to-peer.** No authoritative game server. A signaling server is required, but only for WebRTC connection setup — it relays no gameplay data once peers are connected.
- **Only classified, discrete events cross the network — never raw pose landmarks and never video.** E.g., `{ type: "cross", hand: "rear", frame: 1234 }`, not a stream of (x,y,z) coordinates. This is a network-efficiency, fairness, and anti-cheat-surface decision — see `docs/04-NETWORKING-AND-NETCODE.md`.
- **License-clean stack only.** MediaPipe is Apache-2.0. Do not introduce Ultralytics YOLO-pose (AGPL-3.0) or other copyleft-licensed models without an explicit, deliberate decision to accept that tradeoff.
- **LAN/same-network play is the first playable milestone; internet play (with TURN relay) comes after.** Do not build TURN/internet infrastructure before LAN play is validated and feels fair.

## Working agreement for Claude Code

- **Do not fabricate specific library APIs, method names, or model capabilities you have not verified.** Where this document set describes an approach at a conceptual level rather than exact code, treat that as a direction to investigate and validate — check current library documentation before writing code against a specific API, and flag in `docs/05-TECH-SETUP-AND-RISK-LOG.md` if something in these docs turns out to be inaccurate or outdated.
- **Do not silently upgrade an assumption into a fact.** If a milestone's "done when" criterion involves a measurement (frame rate, classification accuracy, network latency), actually measure it and record the number — don't report a milestone complete based on the plan's expected numbers.
- **Follow the staged plan's risk-first order.** Do not start on networking or polish before the gesture-classification prototype (Milestone 1 in `docs/02-IMPLEMENTATION-PLAN.md`) has been built and measured. If Milestone 1 fails to clear its stated bar, stop and consult the rescoping options in `docs/02-IMPLEMENTATION-PLAN.md` and `docs/05-TECH-SETUP-AND-RISK-LOG.md` rather than pushing forward with a shaky foundation.
- Keep pose-tracking, gesture-classification, game-simulation, networking, and rendering as separate modules from day one — see module boundaries in `docs/01-ARCHITECTURE.md`.
- When a design decision in these docs is marked as tentative or "revisit if," treat it as genuinely open — don't treat everything in this document set as equally settled. The non-negotiable list above is settled; specific numeric thresholds, punch-set scope, and classifier technique are not.

## Relationship to the Flap project

Shares the same base stack and several architectural instincts (client-side pose tracking, separate perception/simulation/rendering layers, tunable constants in one place) but is a substantially larger project, not an incremental extension. Treat it as such in scoping and time estimates. See `docs/01-ARCHITECTURE.md` for the specific deltas.

## Status

**Milestone 0 built and measured (2026-07-22). Its frame-rate criterion was NOT met on the dev machine, which trips a fallback trigger in `docs/02-IMPLEMENTATION-PLAN.md`.**

- Scaffold is up: React + TypeScript + Vite + Three.js, `@mediapipe/tasks-vision` 0.10.35, GPU delegate confirmed engaged, live webcam with a debug landmark overlay. Capture/pose/smoothing layers were adapted from the Flap project (see "Relationship to the Flap project"); the deterministic simulation loop is deliberately not shared with it.
- Measured pose sample rate: **15.1 FPS median (worst 5%: 11.4 FPS)**, against the plan's 24–30 FPS floor. Inference is ~36 ms per frame versus a 33 ms camera frame budget, so the pipeline drops every second frame. Full numbers, hardware, and ruled-out levers are in `docs/05-TECH-SETUP-AND-RISK-LOG.md` open question 3.
- Capture resolution has been **ruled out** as a fix (BlazePose rescales to a fixed internal tensor, so capture size barely affects inference cost).
- A Web Worker inference path has been **built** (`src/pose/poseWorker.ts`, selectable via `?worker=0|1`) on the theory that off-thread inference would pipeline against capture. Early evidence says **it does not help and may hurt** (13.8 FPS vs 15.1 FPS). This is not yet a clean A/B — see open question 3. Run `npm run measure:ab` while standing in frame to settle it.
- The worker path only works against a production build (`npm run build && npm run preview`), never `npm run dev` — see open question 9.

**Frame rate deferred (project owner's call, 2026-07-22):** better hardware and mobile devices will be tested, so 15 FPS on this dev laptop is not treated as blocking. Note the caveat still stands that a confusion matrix measured at 15 FPS understates the classifier — the results screen reports mean pose samples per punch and warns when that number is low.

**Milestone 1 built, NOT yet measured (2026-07-22).**

- `perception/` implements Approach A from `docs/03-GESTURE-CLASSIFICATION.md`: per-hand guard-state FSM for detection, geometric/velocity heuristics for classification. No z is used anywhere — punches travel toward the camera, where depth is least reliable.
- All thresholds are torso-normalized and live in `config/tuning.ts`. They are reasoned from geometry, **not** tuned against data. Expect to revise them once the first confusion matrix exists.
- The harness (`ui/PunchHarness.tsx`) runs calibration, free practice, and a hands-free guided protocol that produces a real confusion matrix scored against bars fixed **before** any data was collected (see open question 2 in the risk log).
- **The accuracy numbers do not exist yet.** They require a person throwing ~20 labelled reps per punch type. Do not report Milestone 1 complete, or pick a classification technique, until that run has happened and its numbers are in the risk log.

**Milestone 2 built, NOT yet validated (2026-07-22).** `perception/dodgeDetector.ts` emits continuous head state (lean/duck), shown live by the dodge indicator during free practice. Built ahead of Milestone 1's result deliberately: head-based dodging is needed in every surviving scope, including the fallback where punch typing is dropped entirely. Its done-when — prompt response with no false triggers from ordinary movement — still requires a real body in front of the camera. Dead zones are reasoned, not tuned.

**Avatar scope amended (2026-07-22):** the full skeletal rig stays out of v1, but a first-person gloves view plus a stylised opponent is now the agreed approach — see the amended scope note in `docs/01-ARCHITECTURE.md`. Not to be built before Milestone 1's measurement resolves, since a rescoped punch set changes the opponent's animation set.

**Milestone 1 run 1 measured and FAILED at the detection stage (2026-07-22 ~22:15).** 19% detection rate, all five pre-set bars failed. This was NOT the anticipated hook/uppercut confusion — 81% of punches were never detected at all, and detection is the half the docs call tractable. Full numbers in `docs/05-TECH-SETUP-AND-RISK-LOG.md` open question 1.

**Do not escalate to DTW on the basis of run 1.** DTW classifies punch trajectories and cannot help with punches that were never detected. The question of whether punch TYPES are separable remains genuinely unanswered.

Detection has since been redesigned (risk log 14): it now measures the fist's excursion from its calibrated guard position rather than wrist-to-shoulder distance, treats a punch as a whole excursion episode, gates on sampling-invariant mean speed, and scales thresholds by the player's measured guard jitter. 53 unit tests pass including all four punch shapes at 10–30 FPS. **None of this has been validated on a real thrown punch** — run 2 is required before any conclusion.

Expect hook/uppercut confusion — `docs/03-GESTURE-CLASSIFICATION.md` treats it as inherent to frontal-camera geometry, not an implementation bug. The escalation path is A → B (DTW) → C (small trained model), and if straight-vs-curved fails after B, stop and rescope with the project owner.

**UI shell and agent harness added (2026-07-28).** Neither touches the perception layer or the milestone order.

- A menu shell now wraps the debug harness: main menu → Train / Fight (locked) / How to play / Settings. The existing `PunchHarness` is reached unchanged from Train. Entries are deliberately punch-set agnostic, so a Milestone 1 descope does not force a UI rewrite. `ui/shell/FightScreen.tsx` states the real gates and exports a single `FIGHT_READY` flag for when Milestone 3 lands.
- `?screen=train` deep-links past the menu; every script in `tools/` was updated to use it, since they all previously landed straight on the camera gate.
- The D5 workflow harness (`agents.md`, `.github/copilot-instructions.md`, `memorybank/`) is installed. Ticket prefix `SB`. It governs how a task proceeds; it does **not** override this file or the risk-first order — see the precedence table in `.github/copilot-instructions.md`.

**Two design questions answered in the risk log (2026-07-28), both raised by the project owner:**

- **Risk log 15 — pro-boxer animation.** Recognition triggers a canned mocap animation; the avatar never mirrors raw pose. This is now the agreed approach and it is a risk *reducer* — it decouples how the game looks from how well tracking works. It does **not** help recognition: Approach A is hand-written thresholds with nothing to train, and a corpus of professional form measures the wrong population. Mocap projected through a virtual camera would be a genuinely better synthetic test bed than `synthetic.ts` (it foreshortens for free), but it costs days where run 2 costs twenty minutes. Do run 2 first.
**Run 2 is being taken on phones (2026-07-28, both players).** This makes risk log 7b live rather than hypothetical, and the interpretation rule matters more than the number: **a phone pass is strongly informative; a phone failure is ambiguous** between the classifier and the device's framing, and must not be recorded as "Approach A failed" or used to justify escalating to DTW. Disambiguate with a laptop run first, even a short one. Five phone-specific defects that would have voided or silently corrupted the run were fixed: spoken prompts (unreadable screen at boxing range), screen wake lock (auto-lock stops the camera and scores the rest as misses), touch abort (no `Esc` on a phone), stage aspect ratio taken from the real stream (a portrait stream was cropped on screen but not in tracking), and HTTPS over LAN via `npm run dev:lan` (`getUserMedia` is secure-context only). Record device, browser, orientation, camera height, FPS at start *and* end, delegate, and `scaleSource` per player.

- **Risk log 16 — player height and reach asymmetry.** Torso normalization plus per-player calibration is exactly the design for this, but it is unmeasured. The taller player is disproportionately exposed to the weaker shoulder-width fallback for torso scale, because they get cropped at the hips first. **Run 2 should produce one confusion matrix per player, not one in total.** Real reach confers no in-game advantage by construction, and that must not later be "fixed".
