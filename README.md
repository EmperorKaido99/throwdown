# Shadow Box

**A 1v1 webcam boxing game you play with your body.** Stand in front of your
webcam, throw real punches, slip and duck real punches — the browser tracks your
pose in real time and turns it into the fight. No controller, no wearables, no
downloads. Two players will fight head-to-head over the network.

Everything runs **client-side in the browser**. Your camera feed never leaves
your machine, and when multiplayer lands, only tiny game events cross the wire —
never video, never raw body data.

> **Project status:** early, and deliberately so. The single hardest problem —
> reliably telling punch *types* apart from one front-facing camera — is being
> proven out first, before any multiplayer code. See [Status](#status) below and
> [`memory.md`](memory.md) for a full handover.

---

## How you play

Your webcam is your controller. Two kinds of movement drive the game:

### Offence — throw punches
The game watches your arms and classifies each punch into one of four types:

| Punch | What it is |
|---|---|
| **Jab** | Quick straight punch with your lead hand |
| **Cross** | Straight power punch with your rear hand |
| **Hook** | Curved punch that swings across your body |
| **Uppercut** | Rising punch that drives upward from below |

### Defence — move your head
| Move | How |
|---|---|
| **Dodge** | Lean your head left or right, over your shoulders |
| **Duck** | Lower your head, or crouch down |

Defence is a *held position*, not a button press — you slip a punch by being in
the right place at the moment it lands, exactly like real boxing.

Because you face the camera, the game first has you **calibrate**: hold your
guard for a moment so it can learn your stance (orthodox or southpaw), your
build, and where your fists rest. Everything after that is measured relative to
*your* body, so it works whether you're tall, short, near, or far from the camera.

## How it's built

```
 webcam ──▶ MediaPipe pose ──▶ perception ──▶ simulation ──▶ render
 (capture)   (33 landmarks)    (punches +      (hits, health   (Three.js)
                                dodge/duck)     — planned)
```

- **Pose tracking** uses Google's [MediaPipe](https://developers.google.com/mediapipe)
  `PoseLandmarker` (Apache-2.0), running on the GPU with a CPU fallback. It gives
  33 body landmarks per frame. The model and runtime are bundled locally, not
  loaded from a CDN.
- **Perception** is the heart of the project. It takes the stream of landmarks
  and answers two questions: *was a punch thrown, and which one?* and *where is
  the head?* It uses only the 2D trajectory, velocity and timing of your joints —
  never depth, which is unreliable for punches thrown toward the lens.
- **Simulation & rendering** (hit resolution, health, avatars) and
  **multiplayer** (WebRTC peer-to-peer) are planned and not built yet.

The stack is React + TypeScript + Vite + Three.js + MediaPipe. Layers are kept
as separate modules from day one so each can be tested and swapped on its own.

### Why this is hard

Telling a jab from a cross is easy. Telling a **hook** from an **uppercut** is
not: both are thrown *toward the camera*, so they're squashed along exactly the
axis that would distinguish them. Comparable research has managed only ~49%
per-punch accuracy on setups like this. So the project is built **risk-first** —
the punch classifier is prototyped and *measured against real thrown punches*
before a single line of networking is written. If it can't be made reliable, the
scope changes before time is sunk into everything downstream.

## Running it

```bash
npm install
npm run dev        # then open http://localhost:5174
```

Click **Enable camera** (browsers only allow camera access on `localhost` or
HTTPS) and follow the on-screen steps. Stand back far enough that your hips,
hands and head are all in frame — a seated desk position won't calibrate.

| Command | What it does |
|---|---|
| `npm run dev` | Dev server |
| `npm run build` | Typecheck + production build |
| `npm run lint` | Lint (oxlint) |
| `npm test` | Unit tests — perception logic against synthetic punch trajectories |

### Trying it without a real match

The app opens on the **punch harness**, which is how the classifier is measured:

1. **Calibrate** — pick your stance, hold your guard.
2. **Free practice** — throw punches and see them labelled live. A **detection
   diagnostics** panel shows exactly why any punch was or wasn't detected, and
   the **dodge/duck indicator** tracks your head.
3. **Measured run** — a hands-free protocol prompts each punch type in turn and
   scores the results into a confusion matrix against fixed accuracy bars.

Every prompt shows a diagram of the punch's trajectory and form cues. You can
review all of them, no camera needed, at `http://localhost:5174/?guides=1`.

> Throw the punch you're asked for *honestly*, including the ones you expect it
> to get wrong — the whole point of a run is to find where it fails.

## Project layout

```
src/
  capture/     getUserMedia — the raw webcam stream
  pose/        MediaPipe inference, landmark types, motion smoothing
  perception/  calibration, punch detection + classification, dodge/duck
  config/      all tunable constants in one place
  debug/       performance stats, confusion-matrix scoring
  ui/          camera overlay, HUD, punch harness, trajectory guides, dodge dot
docs/          architecture, the staged plan, and a living risk/decision log
tools/         Playwright-driven measurement and diagnostic scripts
```

`docs/` is worth reading in numbered order if you want the full design: the
architecture, the risk-first milestone plan, the deep dive on gesture
classification, the networking plan, and the running log of open questions and
measured results.

## Status

| Milestone | State |
|---|---|
| Pose scaffold | Built. ~15 FPS on the dev laptop (below target; faster hardware/mobile to come). |
| Punch classification | Built; detection redesigned after a failed first run. **Awaiting validation on real punches.** |
| Dodge / duck | Built; awaiting validation. |
| Multiplayer (WebRTC) | Not started — intentionally gated behind the classifier proving out. |
| Avatars / opponent | Scoped, not built. |

Whether four-way punch classification is achievable from this camera angle is
still an open question. That's the thing being answered next.

## License notes

Dependencies are kept license-clean: MediaPipe is Apache-2.0. Copyleft
(AGPL-3.0) pose models are deliberately avoided. See
[`docs/05-TECH-SETUP-AND-RISK-LOG.md`](docs/05-TECH-SETUP-AND-RISK-LOG.md).

---

## Development Workflow (D5)

All development follows the **D5 agentic workflow** with continuous progress tracking.

| Command | Description |
|---------|-------------|
| `StartTask SB-XXXX` | Start a new task through the D5 phases |
| `ReviewTasks` | Review all incomplete tasks and resume where you left off |

The five phases are **Define → Discover → Deliver → Demonstrate → Document**.
Deliver and Demonstrate each have a hard stop for human approval.

> The D5 workflow governs *how* a unit of work proceeds. It does not override
> `CLAUDE.md` and `docs/01`–`05`, which govern *what* may be built and in what
> order. A ticket asking for networking before Milestone 1 has a measured
> confusion matrix should be objected to in the Define phase, not planned.

### Agent Configuration

| File | Purpose |
|------|--------|
| [`CLAUDE.md`](CLAUDE.md) | Project rules, non-negotiable technical decisions, current status |
| [`.github/copilot-instructions.md`](.github/copilot-instructions.md) | D5 workflow definition, task tracking, phase gates |
| [`agents.md`](agents.md) | Behavioral guidelines — think first, simplicity, surgical changes |
| [`memorybank/project-context.md`](memorybank/project-context.md) | Tech stack rules, coding conventions, anti-patterns |

### Documentation (Memory Bank)

| File | Contents |
|------|----------|
| [`memorybank/architecture.md`](memorybank/architecture.md) | Module map, data flow, load-bearing invariants |
| [`memorybank/features.md`](memorybank/features.md) | Feature list with **measured** status, and what is not built |
| [`memorybank/integrations.md`](memorybank/integrations.md) | External services (none yet) and browser APIs relied on |
| [`memorybank/setup.md`](memorybank/setup.md) | Local setup, commands, URL flags, how to take a valid measurement |
| [`memorybank/ticket-progress.md`](memorybank/ticket-progress.md) | Status tracker for all `SB` tickets across sessions |
| [`memorybank/changelog.md`](memorybank/changelog.md) | Ad-hoc changes outside task files |
| [`memorybank/components/`](memorybank/components/) | Per-feature documentation (business rules, data flow, validation) |

### Component Documentation

| Component | Doc |
|---|---|
| _(template only — say "document components" to generate these)_ | [`memorybank/components/_index.md`](memorybank/components/_index.md) |
