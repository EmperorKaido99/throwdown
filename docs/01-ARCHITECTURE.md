# Architecture

## What's reused from the Flap project, and what's new

| Layer | Flap (single-player) | Shadow Box (this project) |
|---|---|---|
| Pose tracking | MediaPipe Tasks Vision, client-side | Same — reused as-is |
| Rendering | Three.js/WebGL2 | Same — reused as-is |
| Gesture detection | Single threshold-based flap detector | New, much harder: multi-class punch classifier + head-based dodge/duck detector |
| Game logic | Free-running requestAnimationFrame loop | New: deterministic, fixed-timestep, rewindable simulation (needed for rollback netcode) |
| Networking | None (single-player) | New: WebRTC data channels, signaling server, rollback netcode |
| Infrastructure | None (fully static site) | New: a small always-on Node.js signaling server; STUN always, TURN for internet play |

The pose-tracking and rendering layers are not being rebuilt — this document focuses on the new/changed layers.

## Layered architecture

```
capture/
  useWebcam.ts                  # getUserMedia, one per local player

pose/
  usePoseTracking.ts            # MediaPipe PoseLandmarker wrapper (reused pattern from Flap)
  poseTypes.ts                  # shared landmark/keypoint types
  smoothing.ts                  # jitter filtering (moving average / one-euro) before perception layer

perception/                      # NEW — the hardest layer in this project
  punchClassifier.ts             # landmark history -> punch event (type, hand, confidence) or null
  dodgeDetector.ts                # landmark history -> continuous head-state (dodge x, duck y)
  calibration.ts                  # per-player neutral pose / guard position / torso scale

netcode/                          # NEW
  signalingClient.ts               # talks to the signaling server to establish a WebRTC connection
  dataChannel.ts                   # unordered/unreliable RTCDataChannel wrapper, send/receive typed events
  inputSync.ts                     # local + remote discrete input queue, feeding the simulation
  rollback.ts                      # rollback/resimulation logic (or wraps a library — see 04-NETWORKING-AND-NETCODE.md)

simulation/                       # NEW — deterministic, fixed-timestep
  fightState.ts                    # health, guard, hit/miss resolution, timing windows
  fightSim.ts                      # advance(state, localInput, remoteInput) -> newState; must be pure/serializable

render/
  Scene.tsx                        # Three.js/WebGL2 — renders interpolated simulation state, decoupled from sim tick

signaling-server/                 # NEW — separate small Node.js service, not part of the client bundle
  server.ts                        # room/lobby management, WebRTC SDP/ICE relay only — no gameplay data

ui/
  Lobby.tsx                        # create/join room (LAN or internet)
  CalibrationScreen.tsx             # per-player setup, mirrors Flap's calibration concept
  HUD.tsx                           # health, punch feedback, connection status

config/
  tuning.ts                         # ALL tunable constants (thresholds, timing windows, rollback frame cap)
```

**Why separate `perception/` from `simulation/` from `netcode/`:** each of these three layers is independently the hardest part of a real project (CV classification, deterministic game logic, real-time networking). Keeping them decoupled — perception emits discrete events, simulation consumes local+remote discrete events and stays pure/deterministic, netcode only moves discrete events across the wire — means each can be built, tested, and debugged in isolation. This is exactly the "de-risk one hard problem at a time" approach the implementation plan follows.

## Data that crosses the network — and what does not

**Crosses the network (small, discrete, infrequent):**
- Punch events: type (jab/cross/hook/uppercut), hand (lead/rear), target zone, simulation frame number
- Head/dodge state: a low-rate stream of normalized head position (for opponent's dodge visualization and hit adjudication) — this is continuous but tiny (a couple of floats), not full landmark data
- Match control: ready/start, pause, disconnect, room join/leave

**Never crosses the network:**
- Raw pose landmarks (33 points × x/y/z/visibility) — too much bandwidth, too jittery, exposes more than needed, and would let a modified client re-adjudicate hits itself
- Video/webcam feed — not needed for gameplay, adds bandwidth and privacy concerns
- Anything from `pose/` or `perception/` beyond the classified discrete outputs above

## Determinism requirement

The `simulation/` layer must be a pure function of `(previous state, local input, remote input) -> next state`, running on a fixed timestep (e.g., 60 Hz), and must be cheaply serializable/restorable. This is what makes rollback netcode possible: the netcode layer can re-run `fightSim.advance(...)` from a saved state when a remote input arrives late or differs from a prediction. This is a hard architectural constraint, not a nice-to-have — retrofitting determinism after the fact is significantly harder than designing for it from the start. See `04-NETWORKING-AND-NETCODE.md` for how rollback consumes this.

## Infrastructure additions

- **Signaling server**: a small, always-on Node.js + WebSocket (or similar) service whose only job is room/lobby management and relaying WebRTC SDP offers/answers and ICE candidates so two browsers can find each other. It never sees gameplay data. Needed for both LAN and internet play (WebRTC has no built-in discovery mechanism).
- **STUN**: needed to discover each peer's public address; can use a public STUN server for prototyping.
- **TURN**: a relay server needed as a fallback for internet play when direct peer connections fail (symmetric NATs, strict firewalls). Not needed for LAN-only play — defer this until LAN play is validated. Hosting TURN has real bandwidth cost since it relays all traffic when active.

## What was deliberately scoped out (v1)

- **Ranked/competitive integrity / robust anti-cheat.** Client-authoritative pose input in a P2P game cannot be fully secured against a malicious client. v1 targets casual/friendly play with basic plausibility checks (event-rate limits), not tournament-grade fairness. See `05-TECH-SETUP-AND-RISK-LOG.md`.
- **More than 2 players.** 1v1 only.
- **Full skeletal rig/IK visualization of either player's body** beyond a simple debug overlay — same reasoning as the Flap project: gameplay needs landmark positions and classified events, not a driven visual rig.

  **Amended 2026-07-22 (project owner's decision).** The owner asked for an in-game visual that mirrors their real movements. Rather than reverse this non-goal, the agreed approach is a **first-person view: the player's own gloves driven directly by wrist landmarks, plus a stylised opponent that reacts to classified events.** The full-body rig stays out of scope.

  Reasoning: driving a skeletal rig convincingly from 2D landmarks depends most on the depth axis, which is both MediaPipe's least reliable output and the axis punches travel along (see `03-GESTURE-CLASSIFICATION.md`). A rig would therefore look subtly wrong precisely on punches — the opposite of the intended effect. Gloves positioned from wrist x/y need no depth reconstruction and no IK solve, and the opponent is animated from discrete punch events, which is what already crosses the network. This keeps the "mirrors my movement" goal without taking on the rig's failure mode.

  Sequencing: not to be built before Milestone 1's measurement resolves. If that run rescopes the punch set (dropping uppercut, or collapsing curved punches into a "swing" catch-all), the opponent's animation set changes with it.
- **Hand-landmark tracking (MediaPipe Hands) in v1.** Start with Pose Landmarker's wrist/elbow/shoulder chain only (more robust for fast, toward-camera motion than small, fast-moving hand landmarks). Hands tracking is a possible future addition for fist/open-hand state, not a v1 dependency — see `03-GESTURE-CLASSIFICATION.md`.
