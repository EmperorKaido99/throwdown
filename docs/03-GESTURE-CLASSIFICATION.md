# Gesture Classification: Punch Typing and Dodge Detection

This is the highest-risk part of the project. Read this in full before writing any perception-layer code, and re-read the known-limits section before deciding the project isn't working. A lot of the difficulty here is inherent to the problem (frontal-camera punch classification), not an implementation mistake.

## What MediaPipe actually gives you (verify against current docs before coding)

MediaPipe Pose Landmarker (the same model already used in the Flap project) outputs 33 body landmarks per frame, each with normalized x and y, a z depth, and a visibility/presence score, in both image-normalized and 3D world coordinates. Relevant landmarks for this project: shoulders (11/12), elbows (13/14), wrists (15/16), nose (0), eyes (1 to 6), ears (7/8).

Important limitation to design around: the z depth dimension is the least reliable of the three, per Google's own guidance, and punches in this game are thrown toward the camera, which is exactly the direction depth would matter most and where the arm-angle signal that most simple detectors rely on collapses. Do not design a classifier that depends heavily on precise depth values; lean on x/y trajectory, velocity, and timing instead.

MediaPipe does not classify punch types. There is no built-in punch classifier in MediaPipe or any library referenced in this project. Detecting that a punch happened is a straightforward heuristic problem (rapid arm extension). Classifying which type is the open problem this milestone exists to solve. Do not write code assuming a library provides this. Build and validate it as described below.

## Step 1: punch detection (the easy part)

Detecting that a punch occurred at all is tractable with simple heuristics, directly analogous to the Flap project's flap detector:
- Track a guard state: is the wrist near the shoulder or nose (guard up) or extended away (punch thrown)?
- A rapid increase in elbow-extension angle (the angle at wrist-elbow-shoulder) combined with a spike in wrist velocity, followed by a return toward guard, indicates a punch was thrown.
- Debounce with a cooldown so one punch is not double-counted, same principle as the Flap project's flap debounce.

This part should be relatively quick to get working and is not the risky part of this milestone.

## Step 2: punch type classification (the hard part)

Three approaches, in increasing complexity. Start with the first and only move to the next if it does not clear a usable bar (see Milestone 1's decision point in 02-IMPLEMENTATION-PLAN.md):

**A. Geometric and velocity heuristics plus a state machine (start here).**
- Straight punches (jab, cross): wrist travels in a roughly straight line away from and back to guard, high forward velocity, minimal lateral travel. Disambiguate jab (lead hand) versus cross (rear hand) by which wrist moved.
- Hooks or swipes: wrist travels with significant lateral (horizontal) displacement relative to the shoulder/torso midline.
- Uppercuts: wrist travels with significant upward vertical displacement, often starting lower (near waist/hip height) and rising.
- Known limitation, not a bug to fix: because the player faces the camera, curved punches (hooks, uppercuts) are the hardest to disambiguate from straight punches using this technique. The toward-camera geometry compresses exactly the signal that would normally distinguish them. This is a documented limitation in comparable prior projects, not a sign the implementation is wrong. If this approach cannot reliably separate straight versus curved, that is expected, useful information. Record it and move to option B; do not assume there is a heuristic bug to debug indefinitely.

**B. Dynamic Time Warping (DTW) on recorded trajectories.**
- Record a handful of example trajectories (a short window of wrist/elbow/shoulder positions over time) for each punch type, then classify a new punch by comparing its trajectory shape to the recorded examples (nearest-neighbor under DTW distance).
- Advantages: needs very few examples per class, no model training pipeline, runs in real time.
- Apply a smoothing/median filter to landmark data before computing trajectories. This approach is sensitive to single-frame jitter.
- Investigate current, actively maintained JS/TS implementations of DTW before committing to one. Do not assume a specific package exists without checking.

**C. A small trained classifier (LSTM or feed-forward net on trajectory features).**
- Only pursue this if A and B do not clear a usable bar. Requires collecting labeled training data (recorded punch trajectories with ground-truth labels) and a training pipeline, which is a real time investment.
- If pursued, verify what tooling is currently available and current before committing to a specific approach or library. Training-data volume needed, export format, and browser inference method should all be confirmed against current documentation rather than assumed.

## Known limits from prior research (set expectations accordingly)

- A closely related published study (single static frontal camera, CNN-based punch detection) reported strong overall accuracy but a much weaker per-punch-type F1 score, in a setting with a severe class imbalance (punches are a small fraction of all frames). This means the detect-vs-no-punch problem is easier than the which-punch-type problem, and headline accuracy numbers can be misleading if not broken out per class.
- The closest known prior-art project attempting a similar toward-camera pose-tracked boxing game deliberately did not attempt multi-way punch type classification. It detected only that a punch was thrown, via a guard-state finite state machine noticing the wrist/elbow briefly leave the guard position, and used head position for dodge direction, sidestepping the hardest part of this milestone entirely. That is a legitimate fallback scope for this project too if Milestone 1 does not succeed at full four-way classification.
- Research achieving high (above 90 percent) punch-type classification accuracy has generally relied on wearable sensors or depth cameras, not a single RGB webcam. Treat those results as not directly comparable to what is achievable here, and do not use them to set expectations for this project's webcam-only setup.

Do not treat any specific accuracy percentage from prior research as a guarantee for this project. Hardware, camera placement, player technique, and lighting all vary. Milestone 1's job is to measure this project's own numbers, not to assume research figures transfer directly.

## Head tracking for dodge and duck detection (lower risk)

This part is comparatively well-established:
- Use the same Pose Landmarker output already running for arm tracking. No need for a second model (for example MediaPipe Face Landmarker) unless Milestone 2 reveals the pose model's head landmarks are not precise enough.
- Track nose (and optionally eye/ear) position against a per-player calibrated neutral head box, established during a brief calibration step at match start (see 01-ARCHITECTURE.md).
- Lateral offset from neutral means dodge left or right. Downward offset (or reduced distance between nose and shoulder line) means duck.
- This should be output as continuous state, not discrete events like punches, since dodging is a held position, not a momentary action. The simulation layer reads the opponent's current head state at the moment a punch resolves to determine hit or miss.

## What NOT to build in v1

- MediaPipe Hands tracking. Hands are small and fast-moving, and toward-camera during a punch, exactly the condition under which hand tracking is least reliable. Pose Landmarker's wrist/elbow/shoulder chain is the more robust signal for this game's needs. Only reconsider this if Milestone 1 specifically identifies a gap that hand landmarks (for example fist versus open hand) would solve, and even then treat it as a scoped addition, not a default inclusion.
- A confident four-way classifier before measuring it. Do not ship or build on top of a punch classifier whose accuracy has not been measured against real thrown punches, per the decision point in Milestone 1.
