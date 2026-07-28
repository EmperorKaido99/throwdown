import { useEffect, useRef, useState } from "react";
import {
  FilesetResolver,
  PoseLandmarker,
  type PoseLandmarkerResult,
  type NormalizedLandmark,
} from "@mediapipe/tasks-vision";
import { DEBUG_CONFIG, POSE_CONFIG } from "../config/tuning";
import { MP_LANDMARKS, POSE_KEYS, type Keypoint, type PoseFrame } from "./poseTypes";
import { PoseSmoother } from "./smoothing";
import { RollingStats } from "../debug/perfStats";
import PoseWorker from "./poseWorker?worker";
import type { InitMessage, WorkerResponse } from "./poseWorker";

/** Inverse of the worker's packResult: 4 floats per key, in POSE_KEYS order. */
function unpackFrame(values: Float32Array, timestamp: number): PoseFrame {
  const frame = { timestamp } as PoseFrame;
  for (let i = 0; i < POSE_KEYS.length; i++) {
    const o = i * 4;
    frame[POSE_KEYS[i]] = {
      x: values[o],
      y: values[o + 1],
      z: values[o + 2],
      confidence: values[o + 3],
    };
  }
  return frame;
}

// Ported from the Flap project's pose/usePoseTracking.ts. Structure kept
// (detection on its own rAF loop, latest result written to a ref so inference
// never blocks rendering); extended with the head landmarks Shadow Box needs,
// one-euro smoothing, and real latency/FPS instrumentation for Milestone 0.
//
// API verified against @mediapipe/tasks-vision@0.10.35 vision.d.ts:
//   PoseLandmarker.createFromOptions(WasmFileset, PoseLandmarkerOptions)
//   detectForVideo(videoFrame, timestamp) => PoseLandmarkerResult   (sync overload)
//   result.landmarks: NormalizedLandmark[][]  ({ x, y, z, visibility })

export type PoseStatus = "loading" | "ready" | "error";

function toKeypoint(lm: NormalizedLandmark | undefined): Keypoint {
  if (!lm) return { x: 0, y: 0, confidence: 0 };
  return {
    x: lm.x,
    y: lm.y,
    z: lm.z,
    // visibility is the per-landmark confidence proxy MediaPipe exposes.
    confidence: lm.visibility ?? 0,
  };
}

function resultToFrame(
  result: PoseLandmarkerResult,
  timestamp: number
): PoseFrame | null {
  const pose = result.landmarks?.[0];
  if (!pose) return null;
  const frame = { timestamp } as PoseFrame;
  for (const key of POSE_KEYS) {
    frame[key] = toKeypoint(pose[MP_LANDMARKS[key]]);
  }
  return frame;
}

export interface PoseTrackingHandle {
  /** Latest smoothed pose. Perception layer reads this. */
  poseRef: React.RefObject<PoseFrame | null>;
  /** Latest unsmoothed pose, for side-by-side debug comparison only. */
  rawPoseRef: React.RefObject<PoseFrame | null>;
  /** Interval between completed inferences (ms) — the effective pose sample rate. */
  frameIntervalStats: RollingStats;
  /** Wall-clock cost of a single detectForVideo call (ms). */
  inferenceStats: RollingStats;
  /**
   * Fraction of inferences that actually returned a pose [0,1]. Critical when
   * interpreting timing: with no body in frame BlazePose keeps running its
   * whole-image detector every frame, whereas once a pose is acquired it uses a
   * cheaper tracking path. A timing sample taken at ratio 0 is measuring a
   * different code path than real gameplay.
   */
  poseFoundRatio: React.RefObject<number>;
  status: PoseStatus;
  delegate: "GPU" | "CPU" | null;
  errorMsg: string | null;
  resetStats: () => void;
}

export function usePoseTracking(
  videoRef: React.RefObject<HTMLVideoElement | null>,
  enabled: boolean
): PoseTrackingHandle {
  const poseRef = useRef<PoseFrame | null>(null);
  const rawPoseRef = useRef<PoseFrame | null>(null);

  const frameIntervalStats = useRef(
    new RollingStats(DEBUG_CONFIG.perfWindowSize)
  ).current;
  const inferenceStats = useRef(
    new RollingStats(DEBUG_CONFIG.perfWindowSize)
  ).current;

  const poseFoundRatio = useRef(0);
  const foundCount = useRef(0);
  const totalCount = useRef(0);

  const [status, setStatus] = useState<PoseStatus>("loading");
  const [delegate, setDelegate] = useState<"GPU" | "CPU" | null>(null);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  // Shared by both the main-thread and worker paths, so the two are measured
  // identically and can be compared directly.
  const recordFrame = (
    raw: PoseFrame | null,
    inferenceMs: number,
    completedAt: number,
    lastEnd: React.RefObject<number>,
    smoother: PoseSmoother
  ) => {
    inferenceStats.push(inferenceMs);
    if (lastEnd.current > 0) frameIntervalStats.push(completedAt - lastEnd.current);
    lastEnd.current = completedAt;

    rawPoseRef.current = raw;
    poseRef.current = raw ? smoother.smooth(raw) : null;

    totalCount.current++;
    if (raw) foundCount.current++;
    poseFoundRatio.current = foundCount.current / totalCount.current;
  };
  const recordFrameRef = useRef(recordFrame);
  recordFrameRef.current = recordFrame;

  // ---- Path A: inference on the main thread ----
  useEffect(() => {
    if (!enabled || POSE_CONFIG.useWorker) return;

    let landmarker: PoseLandmarker | null = null;
    let rafId = 0;
    let videoCbId = 0;
    let subscribedVideo: HTMLVideoElement | null = null;
    let cancelled = false;
    let lastVideoTime = -1;
    const lastDetectEnd = { current: 0 };
    const smoother = new PoseSmoother();

    async function createLandmarker(
      resolver: Awaited<ReturnType<typeof FilesetResolver.forVisionTasks>>,
      delegateChoice: "GPU" | "CPU"
    ) {
      return PoseLandmarker.createFromOptions(resolver, {
        baseOptions: {
          modelAssetPath: POSE_CONFIG.modelAssetPath,
          delegate: delegateChoice,
        },
        runningMode: "VIDEO",
        numPoses: POSE_CONFIG.numPoses,
        minPoseDetectionConfidence: POSE_CONFIG.minPoseDetectionConfidence,
        minPosePresenceConfidence: POSE_CONFIG.minPosePresenceConfidence,
        minTrackingConfidence: POSE_CONFIG.minTrackingConfidence,
        // Segmentation masks are unused and cost inference time — leave off.
        outputSegmentationMasks: false,
      });
    }

    async function init() {
      try {
        const resolver = await FilesetResolver.forVisionTasks(
          POSE_CONFIG.wasmRoot
        );
        // GPU delegate first, CPU fallback — a non-negotiable per CLAUDE.md.
        try {
          landmarker = await createLandmarker(resolver, "GPU");
          if (!cancelled) setDelegate("GPU");
        } catch (gpuErr) {
          console.warn("GPU delegate failed, falling back to CPU:", gpuErr);
          landmarker = await createLandmarker(resolver, "CPU");
          if (!cancelled) setDelegate("CPU");
        }
        if (cancelled) {
          landmarker?.close();
          return;
        }
        setStatus("ready");
        scheduleNext();
      } catch (err) {
        console.error("Pose landmarker init failed:", err);
        if (!cancelled) {
          setStatus("error");
          setErrorMsg(err instanceof Error ? err.message : String(err));
        }
      }
    }

    /**
     * Schedules the next inference. Prefers requestVideoFrameCallback (one
     * inference per decoded camera frame, no re-detecting a stale image), which
     * also dodges the ~1 Hz rAF throttle Chrome applies to a backgrounded
     * window — that throttle voided several early measurement runs. Falls back
     * to rAF where rVFC isn't available.
     */
    function scheduleNext() {
      if (cancelled) return;
      const video = videoRef.current;
      if (video && typeof video.requestVideoFrameCallback === "function") {
        // Hold onto the element we actually registered against, so cleanup
        // cancels on that same element rather than whatever the ref points to
        // by the time the effect tears down.
        subscribedVideo = video;
        videoCbId = video.requestVideoFrameCallback(() => detect());
      } else {
        rafId = requestAnimationFrame(() => detect());
      }
    }

    function detect() {
      const video = videoRef.current;
      if (cancelled || !landmarker || !video) {
        scheduleNext();
        return;
      }

      // Guard against re-running on an identical frame. rVFC already
      // guarantees this, but the rAF fallback path does not.
      if (video.readyState >= 2 && video.currentTime !== lastVideoTime) {
        lastVideoTime = video.currentTime;
        const t0 = performance.now();
        try {
          const result = landmarker.detectForVideo(video, t0);
          const t1 = performance.now();
          recordFrameRef.current(
            resultToFrame(result, t0),
            t1 - t0,
            t1,
            lastDetectEnd,
            smoother
          );
        } catch (err) {
          // A transient inference error shouldn't kill the loop.
          console.warn("detectForVideo error:", err);
        }
      }

      scheduleNext();
    }

    init();

    return () => {
      cancelled = true;
      cancelAnimationFrame(rafId);
      subscribedVideo?.cancelVideoFrameCallback?.(videoCbId);
      landmarker?.close();
    };
  }, [videoRef, enabled, frameIntervalStats, inferenceStats]);

  // ---- Path B: inference in a Web Worker ----
  useEffect(() => {
    if (!enabled || !POSE_CONFIG.useWorker) return;

    let cancelled = false;
    let videoCbId = 0;
    let rafId = 0;
    let subscribedVideo: HTMLVideoElement | null = null;
    let lastVideoTime = -1;
    // Backpressure: only one frame in flight at a time. Without this, frames
    // queue up behind a slower-than-realtime worker and pose data arrives ever
    // further behind the player — latency is worse than a dropped frame in a
    // game decided by punch timing.
    let inFlight = false;
    const lastEnd = { current: 0 };
    const smoother = new PoseSmoother();

    // Vite's `?worker` import respects the `worker.format: "iife"` config, so
    // this is a classic worker — required for MediaPipe's importScripts-based
    // WASM loading. See the comment in vite.config.ts.
    const worker = new PoseWorker();

    worker.onmessage = (e: MessageEvent<WorkerResponse>) => {
      const msg = e.data;
      if (cancelled) return;

      if (msg.type === "ready") {
        setDelegate(msg.delegate);
        setStatus("ready");
        scheduleNext();
        return;
      }
      if (msg.type === "error") {
        setStatus("error");
        setErrorMsg(msg.message);
        return;
      }

      // result
      inFlight = false;
      const raw = msg.values ? unpackFrame(msg.values, msg.timestamp) : null;
      recordFrameRef.current(raw, msg.inferenceMs, performance.now(), lastEnd, smoother);
    };

    worker.onerror = (e) => {
      if (cancelled) return;
      setStatus("error");
      setErrorMsg(e.message || "pose worker failed");
    };

    function scheduleNext() {
      if (cancelled) return;
      const video = videoRef.current;
      if (video && typeof video.requestVideoFrameCallback === "function") {
        subscribedVideo = video;
        videoCbId = video.requestVideoFrameCallback(() => void pump());
      } else {
        rafId = requestAnimationFrame(() => void pump());
      }
    }

    async function pump() {
      const video = videoRef.current;
      if (cancelled || !video) {
        scheduleNext();
        return;
      }
      // Skip if the worker is still busy, or the frame isn't new. Skipping is
      // deliberate: showing the freshest available pose beats working through
      // a backlog of stale ones.
      if (!inFlight && video.readyState >= 2 && video.currentTime !== lastVideoTime) {
        lastVideoTime = video.currentTime;
        inFlight = true;
        try {
          const bitmap = await createImageBitmap(video);
          if (cancelled) {
            bitmap.close();
            return;
          }
          worker.postMessage(
            { type: "frame", bitmap, timestamp: performance.now() },
            [bitmap]
          );
        } catch (err) {
          inFlight = false;
          console.warn("createImageBitmap failed:", err);
        }
      }
      scheduleNext();
    }

    worker.postMessage({
      type: "init",
      wasmRoot: POSE_CONFIG.wasmRoot,
      modelAssetPath: POSE_CONFIG.modelAssetPath,
      numPoses: POSE_CONFIG.numPoses,
      minPoseDetectionConfidence: POSE_CONFIG.minPoseDetectionConfidence,
      minPosePresenceConfidence: POSE_CONFIG.minPosePresenceConfidence,
      minTrackingConfidence: POSE_CONFIG.minTrackingConfidence,
    } satisfies InitMessage);

    return () => {
      cancelled = true;
      cancelAnimationFrame(rafId);
      subscribedVideo?.cancelVideoFrameCallback?.(videoCbId);
      worker.terminate();
    };
  }, [videoRef, enabled]);

  const resetStats = () => {
    frameIntervalStats.reset();
    inferenceStats.reset();
    foundCount.current = 0;
    totalCount.current = 0;
    poseFoundRatio.current = 0;
  };

  return {
    poseRef,
    rawPoseRef,
    frameIntervalStats,
    inferenceStats,
    poseFoundRatio,
    status,
    delegate,
    errorMsg,
    resetStats,
  };
}
