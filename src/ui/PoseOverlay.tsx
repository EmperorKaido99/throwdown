import { useEffect, useRef } from "react";
import type { PoseFrame, Keypoint, PoseKey } from "../pose/poseTypes";
import { DEBUG_CONFIG } from "../config/tuning";

// Debug landmark overlay. Ported from the Flap project's ui/PoseOverlay.tsx and
// extended with the head chain plus a raw-vs-smoothed comparison, so the
// one-euro filter's effect is visible rather than assumed.

interface Props {
  poseRef: React.RefObject<PoseFrame | null>;
  rawPoseRef: React.RefObject<PoseFrame | null>;
  /** Video is displayed mirrored (scaleX(-1)); mirror landmarks to match. */
  mirrored?: boolean;
  /** Draw the unsmoothed skeleton underneath, to see what smoothing removed. */
  showRaw?: boolean;
}

const BONES: [PoseKey, PoseKey][] = [
  // Arm chain — the punch classification signal.
  ["leftShoulder", "rightShoulder"],
  ["leftShoulder", "leftElbow"],
  ["leftElbow", "leftWrist"],
  ["rightShoulder", "rightElbow"],
  ["rightElbow", "rightWrist"],
  // Torso — scale reference.
  ["leftShoulder", "leftHip"],
  ["rightShoulder", "rightHip"],
  ["leftHip", "rightHip"],
  // Head — the dodge/duck signal.
  ["leftEar", "leftEye"],
  ["leftEye", "nose"],
  ["nose", "rightEye"],
  ["rightEye", "rightEar"],
];

const POINTS: PoseKey[] = [
  "leftShoulder",
  "rightShoulder",
  "leftElbow",
  "rightElbow",
  "leftWrist",
  "rightWrist",
  "leftHip",
  "rightHip",
  "nose",
  "leftEye",
  "rightEye",
  "leftEar",
  "rightEar",
];

export function PoseOverlay({
  poseRef,
  rawPoseRef,
  mirrored = true,
  showRaw = false,
}: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    let rafId = 0;
    const minConf = DEBUG_CONFIG.minDrawConfidence;

    function resize() {
      if (!canvas) return;
      // Match the backing store to the CSS size so lines stay crisp.
      const dpr = window.devicePixelRatio || 1;
      canvas.width = Math.round(canvas.clientWidth * dpr);
      canvas.height = Math.round(canvas.clientHeight * dpr);
    }
    resize();
    window.addEventListener("resize", resize);

    const px = (kp: Keypoint) => (mirrored ? 1 - kp.x : kp.x) * canvas!.width;
    const py = (kp: Keypoint) => kp.y * canvas!.height;

    function drawSkeleton(
      pose: PoseFrame,
      boneColor: string,
      lineWidth: number,
      drawJoints: boolean
    ) {
      if (!ctx) return;
      ctx.strokeStyle = boneColor;
      ctx.lineWidth = lineWidth;
      for (const [a, b] of BONES) {
        const ka = pose[a];
        const kb = pose[b];
        if (ka.confidence < minConf || kb.confidence < minConf) continue;
        ctx.beginPath();
        ctx.moveTo(px(ka), py(ka));
        ctx.lineTo(px(kb), py(kb));
        ctx.stroke();
      }
      if (!drawJoints) return;

      for (const p of POINTS) {
        const kp = pose[p];
        if (kp.confidence < minConf) continue;
        const isWrist = p === "leftWrist" || p === "rightWrist";
        const isNose = p === "nose";
        // Wrists and nose are the two signals this project lives on, so they
        // get emphasised: wrists drive punch classification, nose drives dodge.
        ctx.fillStyle = isWrist
          ? "rgba(255, 90, 90, 0.95)"
          : isNose
            ? "rgba(120, 180, 255, 0.95)"
            : "rgba(255, 255, 255, 0.9)";
        ctx.beginPath();
        ctx.arc(px(kp), py(kp), isWrist ? 9 : isNose ? 7 : 5, 0, Math.PI * 2);
        ctx.fill();
      }
    }

    function draw() {
      if (!canvas || !ctx) return;
      ctx.clearRect(0, 0, canvas.width, canvas.height);

      const raw = rawPoseRef.current;
      if (showRaw && raw) {
        drawSkeleton(raw, "rgba(255, 160, 0, 0.45)", 3, false);
      }
      const pose = poseRef.current;
      if (pose) {
        drawSkeleton(pose, "rgba(0, 255, 180, 0.9)", 4, true);
      }

      rafId = requestAnimationFrame(draw);
    }
    rafId = requestAnimationFrame(draw);

    return () => {
      cancelAnimationFrame(rafId);
      window.removeEventListener("resize", resize);
    };
  }, [poseRef, rawPoseRef, mirrored, showRaw]);

  return <canvas ref={canvasRef} className="pose-overlay" />;
}
