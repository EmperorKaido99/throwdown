# Networking and Netcode

Read this before writing any multiplayer code, and only after the perception layer (03-GESTURE-CLASSIFICATION.md) and the local deterministic simulation (Milestone 3 in 02-IMPLEMENTATION-PLAN.md) are working. Networking amplifies problems in either of those layers rather than fixing them, so get them right first.

## What crosses the wire, and why

Send classified, discrete events only. Never raw pose landmarks, never video.

Example event shapes (illustrative, not a fixed schema — adjust as the simulation layer's needs become clear):
- Punch event: punch type, which hand, target zone if applicable, and the simulation frame number it corresponds to.
- Head/dodge state: a low-rate stream of normalized head position (lateral offset, vertical/duck offset) — small enough to send frequently without concern.
- Match control: ready, start, pause, disconnect, room join or leave.

Reasons for this design, not just a preference:
- Bandwidth: a handful of floats or a small typed event is tiny compared to streaming 33 landmarks at 30 Hz.
- Jitter resistance: classified events are stable; raw landmark streams carry all of the frame-to-frame tracking noise across the network too.
- Determinism: discrete events map cleanly onto a fixed-timestep simulation's input queue, which is what rollback netcode needs (see below). A continuous raw stream does not.
- Reduced cheating surface: the opponent's client only ever learns "a cross was thrown," not raw video or landmark data it could use to reverse-engineer or manipulate hit detection more freely.

## Transport: WebRTC data channels

RTCDataChannel is the standard browser mechanism for this. Configure it as unordered and unreliable (equivalent to UDP-like behavior), so a single lost packet does not stall delivery of later, more current packets the way an ordered/reliable channel would. Verify the exact current API and configuration options against up-to-date WebRTC documentation before implementing — do not assume specific option names without checking.

Consider a second, reliable/ordered channel for non-time-critical traffic (chat, final score reporting) if needed, separate from the low-latency gameplay channel.

## Signaling server (new infrastructure this project needs)

WebRTC has no built-in discovery mechanism. Two browsers cannot establish a peer connection without some out-of-band channel to exchange connection information (SDP offer/answer and ICE candidates) first. This requires a small, always-on signaling server.

Scope of the signaling server, and no more:
- Room or lobby management (create a room, join a room by code).
- Relay SDP offers and answers between the two peers in a room.
- Relay ICE candidates between the two peers.
- It should carry no gameplay data once the peer connection is established, and does not need to be highly available or scaled beyond small casual use.

A lightweight Node.js service using WebSockets (or a similar real-time channel) is a reasonable implementation choice; verify current best-practice patterns and any maintained helper libraries before building this from scratch — implementation details here can drift from what's described in this document.

## NAT traversal: STUN and TURN

- STUN: needed so a peer can discover its own public-facing address and port. Public STUN servers exist and are commonly used for prototyping; confirm current availability and terms of use before depending on one for anything beyond prototyping.
- TURN: needed as a fallback when a direct peer connection cannot be established (common with symmetric NATs or strict firewalls), because TURN relays the actual media/data traffic rather than just helping peers find each other. This has real bandwidth and hosting cost whenever it is actually used as a relay.
- LAN-only play: often does not need TURN at all, and may not need much beyond basic STUN or even a direct connection — which is exactly why 02-IMPLEMENTATION-PLAN.md sequences LAN play (Milestones 4 through 6) before internet play with TURN (Milestone 7). Do not build TURN infrastructure before LAN play is validated and feels fair.

## Simulation determinism (prerequisite, not optional)

The simulation/fightSim.ts layer (see 01-ARCHITECTURE.md) must be a pure function of (previous state, local input, remote input) producing the next state, run on a fixed timestep, and cheaply serializable. This determinism requirement exists specifically to support rollback netcode: without it, "re-run the simulation from a saved state when a remote input arrives" is not reliably possible. If this was not already validated during Milestone 3 (local hot-seat play), do not proceed with rollback implementation until it is.

## Netcode approach: delay-based first, then rollback

Per 02-IMPLEMENTATION-PLAN.md's staging, do not jump straight to rollback:

1. Delay-based netcode first (Milestone 5). Introduce a small, fixed input delay so both clients agree on what input arrived at what simulated frame, before adding any rollback complexity. This isolates whether networked pose-driven hit detection feels fair over a real LAN connection from whether rollback netcode itself is implemented correctly. If delay-based play already feels bad, the problem is more likely in simulation timing windows or classification latency than in the network layer, and should be diagnosed there first.

2. Rollback netcode (Milestone 6), only after delay-based play feels acceptable. The standard approach (used in numerous commercial fighting games) predicts the remote player's next input, simulates immediately without waiting, and re-simulates from the last known-good state if the true input differs from the prediction once it arrives, typically capping how many frames can be rolled back at once. Investigate existing browser-oriented libraries that implement this pattern over WebRTC before hand-rolling it; verify current maintenance status and API before committing to one, and record the choice and rationale in 05-TECH-SETUP-AND-RISK-LOG.md.

## A specific wrinkle for pose-derived input: the "punch un-happens" problem

Unlike a controller button press, a punch event here is the output of a classifier that only becomes confident partway through a physical motion — meaning there is already some inherent latency before the local input is even known. Stacking network-side prediction on top of that means a rollback misprediction could visibly "undo" a punch that had already started animating on the remote client, which reads as a glitch rather than a smooth correction.

Mitigation to consider: split a punch into two stages sent separately — a low-latency "a punch is starting" signal sent as early as detection allows (so the opponent's client can begin a telegraph animation immediately), followed shortly after by a "punch type and target" refinement once the classifier is confident. Rollback then only needs to refine details in the common case, rather than causing a punch to appear and then disappear entirely. Treat this as a design direction to prototype and validate, not a guaranteed solution — confirm it actually improves perceived feel during Milestone 6 rather than assuming it will.

## Fairness and hardware asymmetry

A player on notably weaker hardware may get a lower effective pose-tracking frame rate than their opponent, which is a real competitive disadvantage in a game where input timing matters. This is called out explicitly in 02-IMPLEMENTATION-PLAN.md's Milestone 8 and 05-TECH-SETUP-AND-RISK-LOG.md as something to measure and potentially mitigate (for example by capping the effective input rate to the slower participant's capability), not something to discover only after shipping.

## Anti-cheat: explicitly limited scope

Because each client is authoritative over its own pose-derived input in a peer-to-peer architecture, a modified client could in principle fabricate implausible inputs (perfect dodges, impossible punch cadence). Full prevention is not realistic in this architecture. Reasonable, proportionate mitigations for a casual/friendly-play target: basic rate limiting on how frequently punch events can be accepted from a given peer, and simple plausibility checks (for example, rejecting a punch cadence no real human could achieve). Do not present this project as having tournament-grade competitive integrity — see 01-ARCHITECTURE.md's scope notes and 05-TECH-SETUP-AND-RISK-LOG.md.
