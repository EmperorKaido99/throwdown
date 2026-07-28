# Architecture

Authoritative source is `docs/01-ARCHITECTURE.md`. This file is the short
operational map an agent reads before touching code.

## Project Structure

```
src/
  capture/      Webcam acquisition (getUserMedia, resolution, readiness)
  pose/         MediaPipe Pose Landmarker + smoothing + optional Web Worker path
  perception/   Punch detection/classification and head dodge state  ← hardest layer
  config/       All tunable constants and persisted user settings
  ui/           React views: debug harness, overlays, guides, shell/menu
  debug/        Instrumentation helpers
tools/          Node/Playwright measurement + diagnostic scripts
docs/           The five design documents (01–05). 05 is the living risk log.
memorybank/     D5 workflow state (this folder)
```

Directories that **do not exist yet** and are expected later, in this order:
`src/simulation/` (Milestone 3), `src/net/` (Milestones 4–6),
`src/render/` (avatar/gloves view, after Milestone 1 resolves).

## Key Modules

| Module | Responsibility |
|--------|---------------|
| `capture/useWebcam` | Acquire the camera stream, report status/errors/resolution |
| `pose/usePoseTracking` | Drive `PoseLandmarker.detectForVideo`, expose smoothed + raw landmarks and frame/inference stats |
| `pose/poseWorker` | Optional off-main-thread inference (`?worker=1`). Build-only — cannot run under `vite dev` |
| `pose/smoothing` | Landmark smoothing shared with the Flap project |
| `perception/calibration` | Per-player guard position vector, guard jitter, torso scale, stance |
| `perception/punchClassifier` | Excursion-based detection FSM + geometric/velocity classification |
| `perception/dodgeDetector` | Continuous head lean/duck state relative to the shoulder line |
| `config/tuning` | Every threshold, torso-normalized, in one place |
| `config/settings` | Persisted user settings (stance, mirror, worker path) |
| `ui/PunchHarness` | Calibration, free practice, and the guided measurement protocol that produces the confusion matrix |
| `ui/shell/*` | Main menu and screen routing around the above |

## Data Flow

```
webcam frame
  → PoseLandmarker.detectForVideo  (GPU delegate, CPU fallback)
  → smoothing
  → perception
       ├── punchClassifier  → discrete PunchEvent { type, hand, frame }
       └── dodgeDetector    → continuous HeadState { lean, duck }
  → simulation   (NOT BUILT — Milestone 3)
  → net          (NOT BUILT — Milestones 4–6; only discrete events cross the wire)
  → render
```

## Load-bearing invariants

Breaking any of these invalidates a downstream layer. See `docs/01-ARCHITECTURE.md`.

1. **No z axis anywhere in `perception/`.** Punches travel toward the camera, which is where MediaPipe depth is least reliable.
2. **Every threshold is torso-normalized.** This is what makes tuning survive a player moving nearer/further, and what makes two players of different heights comparable.
3. **Only discrete classified events cross the network.** Never landmarks, never video.
4. **The simulation, once written, must be a pure `(state, input) → state` function.** Rollback in Milestone 6 depends on it.
5. **Pose tracking is single-stream.** Each client tracks only its own player; the opponent arrives as events. (Risk log 3 corrects an earlier two-stream assumption.)
