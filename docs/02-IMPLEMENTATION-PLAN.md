# Implementation Plan

Work through these milestones in order. The order is deliberately risk-first: the single biggest unknown in this project (can punch types be reliably classified from a frontal webcam?) is validated before a single line of networking code is written. Do not reorder this to "networking first" or "get something playable quickly" — a fun local prototype built on unreliable gesture classification will need to be substantially reworked later.

Every milestone has a "done when" criterion that involves an actual measurement, not a subjective impression. Record the measured numbers in `05-TECH-SETUP-AND-RISK-LOG.md` regardless of whether they meet the bar.

---

## Milestone 0 — Scaffold (reuse from Flap project where possible)
- Stand up the React + TypeScript + Three.js project (or branch/extend the Flap project's codebase if reuse makes sense).
- Get MediaPipe Pose Landmarker running client-side with a live webcam feed and a debug landmark overlay (this is the same as Flap's Milestone 1 — if the Flap project exists and works, this may already be done).
- **Done when:** webcam pose landmarks are visibly tracked and overlaid in real time, at a measured frame rate on your actual target hardware.

## Milestone 1 — Punch classification prototype (single-player, offline, no game yet) — THE MAKE-OR-BREAK STEP
- Build a debug harness: webcam → pose landmarks → your classifier → on-screen label of the detected punch type (or "no punch"), with a visible confidence/score if applicable.
- Start with the simplest approach: a guard-state gate (hand near shoulder/nose = "guarded") plus geometric/velocity heuristics on wrist-elbow-shoulder trajectory (see `03-GESTURE-CLASSIFICATION.md` for the specific signals to try: elbow extension angle and rate, wrist velocity vector, lateral vs. vertical travel).
- Throw each punch type (jab, cross, hook, uppercut) at least 20–30 times each, from a normal boxing stance, straight toward the camera as the game requires. Record a simple confusion matrix (what was thrown vs. what was detected) by hand or with a logging harness.
- **Done when:** you have an actual measured per-class accuracy/confusion matrix, not a gut feeling. Compare against the benchmark below before proceeding.
- **Decision point (do not skip):**
  - If straight punches (jab/cross) classify reliably but hooks/uppercuts don't → this matches prior art's experience (see `03-GESTURE-CLASSIFICATION.md`); consider descoping to jab/cross/hook and dropping uppercut, or accept a "swing" catch-all category for curved punches rather than a confident 4-way split, and move on.
  - If even straight-vs-curved is unreliable → do not proceed to networking. Try a DTW-based classifier or a small trained model (see `03-GESTURE-CLASSIFICATION.md`) before continuing. If that also fails to clear a usable bar, stop and reassess project scope with the user — this is a legitimate outcome, not a failure of implementation effort.
  - Log the actual numbers and the decision made in `05-TECH-SETUP-AND-RISK-LOG.md`.

## Milestone 2 — Head dodge/duck detection (offline, no game yet)
- Using the same debug harness, track nose (and optionally eye/ear) landmark position against a calibrated neutral head box; detect lateral dodges (left/right) and ducks (down) as continuous state, not discrete events.
- **Done when:** dodging/ducking in front of the camera visibly and promptly updates an on-screen indicator, with no noticeable false triggers from normal head movement (e.g., just looking around, natural sway).

## Milestone 3 — Local two-player hot-seat simulation (no network yet)
- Build the deterministic, fixed-timestep `simulation/fightSim.ts`: health, guard state, hit/miss resolution windows, using two locally-generated input streams — e.g., one from your webcam classifier and one from a keyboard-driven stand-in for the second player (or two people sharing one machine with two webcams if available).
- This validates hit-resolution timing, guard mechanics, and game feel with zero network variables in play.
- **Done when:** a full match (start to win/loss) is playable locally with both players' actions resolving sensibly, and the simulation code is verified to be a pure function of (state, input) → new state (a hard requirement for rollback later — see `01-ARCHITECTURE.md`).

## Milestone 4 — Signaling server + basic WebRTC connection
- Stand up the minimal Node.js signaling server (room create/join, SDP/ICE relay only).
- Establish a WebRTC data channel between two browser tabs/machines on the same local network, and confirm you can send and receive a simple test message.
- **Done when:** two clients on the same LAN can find each other via the signaling server and exchange messages over an unordered/unreliable data channel, with measured round-trip latency logged.

## Milestone 5 — Wire discrete events over the network (delay-based, no rollback yet)
- Send classified punch events and head-state over the data channel between two real players on the same LAN.
- Use simple delay-based netcode first (a small fixed input delay so both clients see the same input at the same simulated frame) — not rollback yet. This isolates "does networked pose-driven hit detection feel fair on a real LAN" from "does rollback netcode work," which are two separate risks.
- **Done when:** two players on the same LAN can play a full match against each other and it feels reasonably fair — record specific complaints/observations (e.g., "dodges feel late," "punches register a beat behind") in the risk log rather than dismissing them.

## Milestone 6 — Rollback netcode
- Only after Milestone 5 feels acceptable on delay-based netcode: introduce rollback (evaluate an existing library such as netplayjs before hand-rolling this — see `04-NETWORKING-AND-NETCODE.md`) to reduce perceived input latency.
- Handle the "punch un-happens on rollback" visual concern explicitly (see `04-NETWORKING-AND-NETCODE.md` for the two-stage punch-event mitigation).
- **Done when:** rollback is verifiably reducing perceived latency (measure, don't assume) without introducing new visual glitches that make hits/dodges feel worse than the delay-based version from Milestone 5.

## Milestone 7 — Internet play (STUN + TURN)
- Add TURN relay fallback for players not on the same network. This is infrastructure with real hosting cost (TURN relays all traffic when direct connection fails) — confirm it's actually wanted before investing here.
- **Done when:** two players on different networks/ISPs can connect and play, with connection-failure states (no direct path, TURN unavailable) handled gracefully rather than silently hanging.

## Milestone 8 — Polish and fairness pass
- Per-player calibration UX (neutral stance, guard position, torso scale) at match start.
- Hardware-asymmetry check: verify the game is still reasonably fair when one player has a notably weaker device/lower pose-tracking frame rate than the other (see `05-TECH-SETUP-AND-RISK-LOG.md`) — consider capping/normalizing effective input rate if this is a problem.
- Basic plausibility/anti-abuse checks (e.g., rate-limiting implausible punch cadence) — explicitly not full anti-cheat; see `01-ARCHITECTURE.md` scope notes.
- **Done when:** the full loop — lobby, calibration, match, win/loss, rematch — works end to end and has been played by at least two different people, not just the developer.

---

## Explicit non-goals for v1 (revisit only with a clear reason)
- More than 1v1.
- Tournament-grade anti-cheat.
- Hand-landmark (MediaPipe Hands) tracking — Pose Landmarker's wrist/elbow/shoulder chain only, unless Milestone 1 shows this is insufficient.
- ~~Mobile/phone camera support (laptop webcam only, matching the Flap project's scope).~~ **Under review (2026-07-22):** the project owner intends to test on mobile devices as well as a more powerful desktop. This is not yet a committed v1 goal, but it is no longer a firm non-goal. Consequences to weigh before committing: phone cameras differ in aspect ratio, field of view, height and typical framing (often portrait, often closer), all of which shift the geometric thresholds the punch classifier depends on. Milestone 1 is deliberately still being built and measured against **laptop-webcam framing only** — mobile framing would need its own calibration and its own confusion matrix, not an assumption that laptop thresholds transfer.

## Fallback triggers (stop and reassess, don't push through)
- Milestone 1 fails to clear a usable classification bar even after trying a DTW/trained-model approach → stop and rescope with the user (fewer punch types, different input, or a different game concept) rather than shipping unreliable core mechanics.
- Milestone 4/5 shows LAN round-trip latency or jitter that makes even delay-based netcode feel bad → the problem is likely upstream (classification latency, simulation timing windows), not the network — revisit `03-GESTURE-CLASSIFICATION.md` and simulation timing before adding rollback complexity on top of a shaky foundation.
- Pose tracking frame rate on real target hardware falls well below 24–30 FPS → see the fallback options noted in `05-TECH-SETUP-AND-RISK-LOG.md` (lighter model, MoveNet fallback, or input-rate capping) before continuing.
