# Setup

## Prerequisites

| Tool | Version | Notes |
|---|---|---|
| Node.js | 20+ | |
| npm | 10+ | |
| A webcam | any | Required for everything except `?guides=1` |
| Chromium/Chrome | recent | Diagnostics in `tools/` drive it via Playwright |

## Environment Variables

| Variable | Purpose | Required | Default |
|----------|---------|----------|---------|
| `BASE_URL` | Which server the `tools/` diagnostics attach to | No | `http://localhost:5174` |

`BASE_URL` exists because the sibling Flap project also uses port 5173; a
diagnostic once silently screenshotted the wrong application. Always set it
explicitly when both projects are running.

## Getting Started

```bash
npm install
npm run dev          # http://localhost:5174
```

## Commands

| Command | What it does |
|---|---|
| `npm run dev` | Dev server on port 5174. **The Web Worker pose path does not work here** (risk log 9) |
| `npm run build` | `tsc -b` then `vite build` |
| `npm run preview` | Preview server on 4173 — required to exercise `?worker=1` |
| `npm run test` | Vitest, single run |
| `npm run lint` | oxlint |
| `npm run measure` | Pose frame-rate measurement (`tools/measure-pose.mjs`) |
| `npm run measure:ab` | Back-to-back main-thread vs worker A/B |

## URL flags

| Flag | Effect |
|---|---|
| `?worker=1` / `?worker=0` | Force the worker / main-thread inference path (build + preview only) |
| `?guides=1` | Punch trajectory reference and synthetic dodge preview, no camera needed |

## Running measurements

Measurement runs are the project's real deliverables, and they are easy to
corrupt. Before recording any number:

1. **The Chrome window must be genuinely foregrounded and unobscured** for the
   whole run. An occluded window throttles rAF to ~1 Hz and produces a
   confident, completely fake number. Launch flags do not prevent this.
2. **Someone must be standing in frame.** BlazePose runs an expensive
   whole-image detector until a body is acquired, so an empty-room run times
   the wrong code path. The harness reports the body-found ratio and warns
   below 50%.
3. **Discard the warm-up.** The first ~6 s include WASM init and shader
   compilation; the harness already drops it.
4. **Never compare runs taken minutes apart.** Inference cost on the dev laptop
   drifted 36.4 ms → 51.3 ms within one session purely from background load.
   A/B conditions must run back-to-back with alternating order.

Record the number in `docs/05-TECH-SETUP-AND-RISK-LOG.md` whether or not it
meets the bar.

## Do not

- Do not run a broad `pkill -f vite` — it kills the sibling Flap project's dev server too.
- Do not hard-code `localhost:5173` in a tool; honour `BASE_URL`.
