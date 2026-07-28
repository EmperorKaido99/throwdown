---
date: '2026-07-28'
sections_completed: ['stack', 'language', 'framework', 'testing', 'quality', 'workflow', 'dont-miss']
status: 'generated_from_codebase'
---

# Project Context for AI Agents

_This file contains the unobvious rules and patterns AI agents must follow when implementing code in this project. It is not a tutorial or onboarding doc — it captures the things an agent would otherwise get wrong._

> Populated directly from the codebase and `docs/01`–`05` on 2026-07-28. Say
> **"generate project context"** to re-derive it interactively.

---

## Technology Stack & Versions

| Thing | Version | Constraint it imposes |
|---|---|---|
| React | 19.2 | Function components + hooks only. No class components anywhere in the tree. |
| TypeScript | strict, `tsc -b` in the build | A type error fails `npm run build`. Do not `@ts-expect-error` past a real type problem. |
| Vite | dev on **5174**, preview on 4173 | Port 5173 belongs to the sibling Flap project. |
| `@mediapipe/tasks-vision` | 0.10.35 (pinned, matches Flap) | API verified against `node_modules/.../vision.d.ts`, not from memory. |
| `three` | 0.185.1 | Not yet load-bearing — no avatar/renderer exists. |
| Vitest | — | `npm run test` is a single run, not watch. |
| oxlint | — | `npm run lint`. |

## Critical Implementation Rules

### Language-Specific Rules

- Perception outputs are a closed vocabulary in `src/perception/punchTypes.ts` (`PunchType`, `HandSide`, `Stance`, `PunchFamily`). Add to that file, never inline a string literal punch name elsewhere.
- `PunchFamily` (straight vs curved) is a first-class concept on purpose: it is the surviving distinction if the four-way split fails. Do not collapse it into `PunchType`.
- Prefer plain numeric records over classes in the perception layer — the simulation must later be a pure function, and structural data makes that easier.

### Framework-Specific Rules

- Pose data flows through **refs, not state**. `poseRef`/`rawPoseRef` are read inside animation frames; putting per-frame landmarks in React state would re-render at camera rate.
- `useEffect` dependencies on detector/tracker objects are a known live bug source: a subscription keyed on an object that changes identity every render unsubscribes and resubscribes constantly, and a punch landing in the gap is silently lost (risk log 11). Depend on **stable callbacks**, not object identity.
- Anything that must run without a camera needs a URL-flag escape hatch (`?guides=1` is the precedent).

### Testing Rules

- Tests live beside the code as `*.test.ts` in `src/perception/`. Run with `npm run test`.
- **Synthetic-trajectory tests prove plumbing, not accuracy.** `src/perception/synthetic.ts` cannot reproduce toward-camera foreshortening, which is the single failure mode that has actually broken this project. A green suite is not evidence the classifier works on real punches.
- Any new punch shape added to `synthetic.ts` must be exercised at 30/20/15/12/10 FPS. Sampling rate has already produced two false conclusions here.
- When you fix a detection or classification bug, add the test that fails on the *real* failure mode first. A test that cannot fail on the bug is worth very little.

### Code Quality & Style Rules

- **Every threshold lives in `src/config/tuning.ts`.** No magic numbers in perception code.
- **Every threshold is torso-normalized.** Raw image units are a bug — one already existed, understating wrist speed roughly threefold.
- Comments in this codebase explain *why the geometry demands it*, not what the line does. Match that register.
- Record whether a constant is **reasoned** or **measured**. Most are currently reasoned. Do not let a reasoned number quietly become a measured one.

### Development Workflow Rules

- Branch: `claude/<topic>`; the current designated branch is `claude/agent-harness-prompt-setup-y3a6qh`.
- D5 workflow per `.github/copilot-instructions.md` — no code before explicit approval in the Deliver phase.
- Update `docs/05-TECH-SETUP-AND-RISK-LOG.md` in the same change that invalidates or confirms an assumption. Never delete a resolved entry; mark it resolved with the finding.
- Do not run `pkill -f vite`.

### Critical "Don't-Miss" Rules

1. **Never use the z axis in `src/perception/`.** Punches travel along the optical axis, where MediaPipe depth is least reliable. This is the whole reason the layer is 2D.
2. **Never report a number you did not measure.** Frame rates, detection rates, accuracies and latencies come from a run, never from the plan's expected value. This rule has the highest precedence in the repository.
3. **Never send landmarks or video over the network.** Only discrete classified events. This is a fairness, bandwidth and anti-cheat decision, not an optimisation.
4. **Do not introduce AGPL-licensed models** (e.g. Ultralytics YOLO-pose). MediaPipe is Apache-2.0 and the stack must stay license-clean.
5. **Do not skip ahead in the milestone order.** Networking, rollback, TURN and the avatar rig are all gated behind a measured Milestone 1. A fun prototype on unreliable classification gets rewritten.
6. **Do not escalate to DTW or a trained model because run 1 looked bad.** Run 1 failed at *detection*; DTW classifies trajectories and cannot help with punches that were never detected.
7. **Tuning a threshold until a number improves is tuning-to-the-test.** Thresholds change when the geometry justifies it, or when instrumentation shows which gate rejected what — not to make a matrix look better.

---

## Usage Guidelines

**For AI agents:** Read this file before implementing. When a rule applies, follow it exactly. When in doubt between this file and a generic best practice, prefer this file.

**For humans maintaining this file:** Keep it lean. Every rule consumes context budget on every future invocation. If a rule has become obvious from the code itself, remove it. Update when the tech stack or conventions change.

Last Updated: 2026-07-28
