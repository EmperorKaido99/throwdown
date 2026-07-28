# Ticket Progress

Track the status of all SB tasks across sessions. Updated at **every phase transition** in the D5 workflow.

## Status Legend

| Emoji | Status | Meaning |
|-------|--------|---------|
| 🔍 | Discovery | Investigating the codebase |
| 📋 | Awaiting Approval | Implementation plan ready, waiting for human approval |
| 🚧 | In Progress | Approved and actively being implemented |
| 🧪 | Testing | Running tests and verifying the fix |
| 📝 | Documenting | Writing up changes and updating docs |
| ✅ | Done | Completed and moved to completedTasks/ |
| 🚫 | Blocked | Cannot proceed — see Notes |

## Tickets

The backlog below is seeded from `docs/02-IMPLEMENTATION-PLAN.md`. The order is
risk-first and is **not** negotiable by ticket priority — see
`.github/copilot-instructions.md` § Precedence.

| Ticket | Title | Status | Last Updated | Notes |
|--------|-------|--------|--------------|-------|
| SB-001 | Milestone 1 run 2 — measured punch confusion matrix | 🚫 Blocked | 2026-07-28 | **The gate for the whole project.** Needs a human throwing ~20 labelled reps × 4 punch types into a webcam. No agent can unblock this. Run 1 failed at detection (19%); detection has since been redesigned but never tested on a real punch. |
| SB-002 | Milestone 2 validation — dodge/duck false-trigger pass | 🚫 Blocked | 2026-07-28 | Needs a real body. Combine with SB-001 in one session. |
| SB-003 | Settle the Web Worker A/B (`npm run measure:ab`) | 🚫 Blocked | 2026-07-28 | Needs a person standing in frame for the whole run, against `build && preview` (not `dev` — risk log 9). |
| SB-004 | UI shell, main menu, mobile-responsive layout | ✅ Done | 2026-07-28 | Menu → Train / Measure / How to play / Settings / Fight (locked). Deliberately punch-set agnostic. |
| SB-005 | Agent harness (D5 + memorybank) | ✅ Done | 2026-07-28 | This scaffolding. |
| SB-006 | Milestone 3 — deterministic hot-seat fight simulation | 📋 Not started | 2026-07-28 | Blocked on SB-001 by risk order. `src/simulation/` does not exist yet. |
| SB-007 | Avatar + canned pro-boxer punch animation | 📋 Not started | 2026-07-28 | Design agreed (see risk log 15): recognition triggers a mocap animation; the avatar never mirrors raw pose. Animation set depends on the surviving punch set, so blocked on SB-001. |
| SB-008 | Milestone 4 — signaling server + WebRTC data channel | 📋 Not started | 2026-07-28 | Blocked by risk order. |
| SB-009 | Milestone 5 — discrete events over LAN, delay-based netcode | 📋 Not started | 2026-07-28 | Blocked by risk order. |
| SB-010 | Milestone 6 — rollback netcode | 📋 Not started | 2026-07-28 | Only if SB-009 feels acceptable first. |
| SB-011 | Milestone 7 — internet play (STUN + TURN) | 📋 Not started | 2026-07-28 | Real hosting cost. Confirm it is wanted before starting. |
| SB-012 | Milestone 8 — polish and fairness pass | 📋 Not started | 2026-07-28 | Includes hardware-asymmetry fairness. |
| SB-013 | Mobile target decision + its own calibration/confusion matrix | 📋 Not started | 2026-07-28 | Risk log 7b. Laptop thresholds must not be assumed to transfer to phone framing. |
