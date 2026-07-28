import { useEffect, useRef, useState } from "react";
import { useWebcam } from "./capture/useWebcam";
import { usePoseTracking } from "./pose/usePoseTracking";
import { PoseOverlay } from "./ui/PoseOverlay";
import { DebugHud } from "./ui/DebugHud";
import { PunchHarness } from "./ui/PunchHarness";
import { PunchGuide } from "./ui/PunchGuide";
import { DodgeIndicator } from "./ui/DodgeIndicator";
import { NEUTRAL_HEAD_STATE, type HeadState } from "./perception/dodgeDetector";
import type { PunchType, Stance } from "./perception/punchTypes";
import "./App.css";

// Root view. Toggles between the Milestone 0 pose scaffold (webcam ->
// MediaPipe landmarks -> debug overlay, with measured frame rate) and the
// Milestone 1 punch harness. No networking yet — that follows the risk-first order.

export default function App() {
  const [started, setStarted] = useState(false);
  const [showRaw, setShowRaw] = useState(false);
  const [mode, setMode] = useState<"pose" | "punch">("punch");

  const { videoRef, status: camStatus, error: camError, info } = useWebcam(started);
  const {
    poseRef,
    rawPoseRef,
    frameIntervalStats,
    inferenceStats,
    poseFoundRatio,
    status: poseStatus,
    delegate,
    errorMsg,
    resetStats,
  } = usePoseTracking(videoRef, started && camStatus === "ready");

  // Debug hook: lets measurement/diagnostic scripts inspect the live pose,
  // e.g. to find which landmark is failing a confidence gate.
  useEffect(() => {
    (window as unknown as Record<string, unknown>).__shadowboxPose = () =>
      poseRef.current;
  }, [poseRef]);

  // ?guides=1 renders the punch trajectory reference on its own, with no
  // camera or calibration. Useful for reviewing the diagrams, and for
  // screenshotting them in a diagnostic run.
  if (new URLSearchParams(window.location.search).has("guides")) {
    return <GuideGallery />;
  }

  if (!started) {
    return (
      <div className="gate">
        <h1>Shadow Box</h1>
        <p className="gate-sub">Milestone 0 — pose tracking scaffold</p>
        <p className="gate-body">
          Grants camera access, runs MediaPipe Pose Landmarker locally, and
          measures the real pose sample rate on this machine. Nothing leaves the
          browser.
        </p>
        <button className="gate-btn" onClick={() => setStarted(true)}>
          Enable camera
        </button>
      </div>
    );
  }

  return (
    <div className={`app ${mode === "punch" ? "app-wide" : ""}`}>
      <div className="stage">
        <video ref={videoRef} className="video" playsInline muted />
        <PoseOverlay
          poseRef={poseRef}
          rawPoseRef={rawPoseRef}
          mirrored
          showRaw={showRaw}
        />
      </div>

      <div className="panel">
        <div className="modes">
          <button
            className={mode === "punch" ? "active" : ""}
            onClick={() => setMode("punch")}
          >
            Milestone 1 — punches
          </button>
          <button
            className={mode === "pose" ? "active" : ""}
            onClick={() => setMode("pose")}
          >
            Milestone 0 — pose
          </button>
        </div>

        {mode === "punch" && (
          <PunchHarness poseRef={poseRef} enabled={poseStatus === "ready"} />
        )}

        <DebugHud
          frameIntervalStats={frameIntervalStats}
          inferenceStats={inferenceStats}
          poseFoundRatio={poseFoundRatio}
          poseStatus={poseStatus}
          delegate={delegate}
          camera={info}
          onReset={resetStats}
        />

        <label className="toggle">
          <input
            type="checkbox"
            checked={showRaw}
            onChange={(e) => setShowRaw(e.target.checked)}
          />
          show unsmoothed skeleton (orange)
        </label>

        {camStatus === "denied" && (
          <p className="err">
            Camera permission denied. Allow access and reload.
          </p>
        )}
        {camError && camStatus !== "denied" && <p className="err">{camError}</p>}
        {errorMsg && <p className="err">pose: {errorMsg}</p>}
      </div>
    </div>
  );
}

/**
 * Standalone view of the punch trajectory guides, for both stances.
 * Reachable at ?guides=1 — no camera required.
 */
function GuideGallery() {
  const [stance, setStance] = useState<Stance>("orthodox");

  // Drive the dodge indicator from a synthetic head state so its rendering can
  // be checked without a camera or a calibrated player. Logic correctness is
  // covered by dodgeDetector.test.ts; this is purely to see the thing move.
  const mockHead = useRef<HeadState>(NEUTRAL_HEAD_STATE);
  useEffect(() => {
    let raf = 0;
    const tick = () => {
      const t = performance.now() / 1000;
      mockHead.current = {
        tracked: true,
        lean: Math.sin(t * 1.1),
        duck: (Math.sin(t * 0.7) + 1) / 2,
        raw: { lateral: Math.sin(t * 1.1) * 0.3, headDrop: 0, bodyDrop: 0 },
      };
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, []);

  return (
    <div className="harness" style={{ maxWidth: 620, margin: "2rem auto" }}>
      <h2>Dodge indicator (synthetic preview)</h2>
      <DodgeIndicator headStateRef={mockHead} />

      <h2>Punch reference</h2>
      <p className="muted small">
        Diagrams are mirrored to match the webcam preview, so your lead hand
        appears on the same side here as it does on screen.
      </p>
      <div className="row">
        <label>
          Stance:{" "}
          <select
            value={stance}
            onChange={(e) => setStance(e.target.value as Stance)}
          >
            <option value="orthodox">Orthodox (left hand leads)</option>
            <option value="southpaw">Southpaw (right hand leads)</option>
          </select>
        </label>
      </div>
      {(["jab", "cross", "hook", "uppercut"] as PunchType[]).map((t) => (
        <div key={t}>
          <div className="guide-title">{t.toUpperCase()}</div>
          <PunchGuide type={t} stance={stance} />
        </div>
      ))}
    </div>
  );
}
