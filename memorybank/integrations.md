# Integrations

## External APIs

Shadow Box is deliberately **fully client-side**. There is no backend, no
analytics, no telemetry, and no account system. Nothing leaves the browser.

| Service | Purpose | Auth Method | Notes |
|---------|---------|-------------|-------|
| _(none yet)_ | — | — | — |

## Planned

| Service | Purpose | Milestone | Notes |
|---------|---------|-----------|-------|
| Signaling server (self-hosted Node) | WebRTC SDP/ICE relay for room create/join | 4 | Relays **no gameplay data** once peers connect. Not an authoritative game server. |
| STUN | NAT traversal | 4 | Public STUN is acceptable |
| TURN | Relay fallback when no direct path exists | 7 | Real bandwidth cost — relays all traffic. Confirm it is wanted before provisioning. |

## Browser APIs relied on

| API | Used for | Failure mode to handle |
|---|---|---|
| `getUserMedia` | Webcam | Permission denied, no device, device busy |
| WebGL2 / WebGPU delegate | MediaPipe GPU inference | Falls back to CPU delegate |
| WebAssembly | MediaPipe runtime | Served from `public/`, not a CDN — no version skew |
| `requestVideoFrameCallback` / `requestAnimationFrame` | Frame pacing | Throttles to ~1 Hz when the window is occluded — see risk log 8 |
| Web Worker (classic/IIFE format) | Optional off-thread inference | Cannot run under `vite dev` — see risk log 9 |
| `localStorage` | Persisted user settings | Absent/blocked in private modes — settings fall back to defaults |
| WebRTC `RTCDataChannel` | Peer gameplay events (planned) | — |

## Model and runtime assets

`pose_landmarker_lite.task` and the MediaPipe WASM runtime are vendored into
`public/mediapipe/` rather than fetched from a CDN. The `public/` copies were
diffed byte-for-byte against `node_modules/@mediapipe/tasks-vision/wasm`. Keep
them in sync when the package version changes.
