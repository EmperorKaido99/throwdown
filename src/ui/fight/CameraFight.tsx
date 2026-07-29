import { useCallback, useEffect, useRef, useState } from "react";
import type { PoseFrame } from "../../pose/poseTypes";
import { usePunchDetection } from "../../perception/usePunchDetection";
import { calibrationWarnings } from "../../perception/calibration";
import { PERCEPTION_CONFIG } from "../../config/tuning";
import type { Stance } from "../../perception/punchTypes";
import { cameraInput, type QueuedPunch } from "../../simulation/cameraInput";
import type { FighterInput } from "../../simulation/fightSim";
import { FightView, type Opponent } from "./FightView";
import { PunchGuideGrid } from "../PunchGuide";

// Camera-driven fight. Calibrate, then box.
//
// This is the first time the perception layer drives the game rather than a
// measurement harness. Note what it does NOT do: it never looks at accuracy,
// confidence or diagnostics. A punch the detector reports is a punch the fight
// throws. If detection is unreliable, that shows up as the game feeling
// unresponsive, which is a far more useful signal than a confusion matrix and
// is the whole reason for wiring it this way round.

interface Props {
  poseRef: React.RefObject<PoseFrame | null>;
  poseReady: boolean;
  streamRef: React.RefObject<MediaStream | null>;
  opponent: Opponent;
  onExit: () => void;
}

export function CameraFight({
  poseRef,
  poseReady,
  streamRef,
  opponent,
  onExit,
}: Props) {
  const [stance, setStance] = useState<Stance>("orthodox");
  const [fighting, setFighting] = useState(false);

  const detection = usePunchDetection(poseRef, poseReady);
  const { phase, calibration, calibrationProgress, headState, onPunch, startCalibration } =
    detection;

  // A punch waits here until the next simulation tick consumes it. One slot,
  // not a list: two punches inside a single 16ms tick is not a thing a human
  // does, and queueing them would let a burst of false detections stack up into
  // a combo the player never threw.
  const queued = useRef<QueuedPunch | null>(null);
  useEffect(() => {
    return onPunch((e) => {
      if (!queued.current) queued.current = { type: e.type, hand: e.hand };
    });
  }, [onPunch]);

  const playerInput = useCallback((): FighterInput => {
    const input = cameraInput(queued.current, headState.current);
    queued.current = null;
    return input;
  }, [headState]);

  if (fighting) {
    return (
      <FightView
        opponent={opponent}
        playerInput={playerInput}
        selfView={<SelfView streamRef={streamRef} />}
        onExit={() => {
          setFighting(false);
          onExit();
        }}
      />
    );
  }

  const warnings = calibration ? calibrationWarnings(calibration) : [];
  const pct = Math.min(
    100,
    (calibrationProgress / PERCEPTION_CONFIG.calibrationMinSamples) * 100
  );

  return (
    <div className="screen">
      <h2>Get in your stance</h2>
      {!poseReady && (
        <p className="muted">Starting the camera and pose tracker…</p>
      )}

      <p className="screen-lead">
        Stand back far enough that your hips are in shot, hands up in guard, and
        hold still. Calibration measures where your guard actually sits — every
        punch is measured as travel away from it.
      </p>

      <div className="row">
        <label>
          Stance:{" "}
          <select
            value={stance}
            onChange={(e) => setStance(e.target.value as Stance)}
            disabled={phase === "calibrating"}
          >
            <option value="orthodox">Orthodox (left hand leads)</option>
            <option value="southpaw">Southpaw (right hand leads)</option>
          </select>
        </label>
      </div>

      {phase === "calibrating" && (
        <>
          <div className="bar">
            <div className="bar-fill" style={{ width: `${pct}%` }} />
          </div>
          <p className="muted small">
            {calibrationProgress} / {PERCEPTION_CONFIG.calibrationMinSamples}{" "}
            still frames — the count only advances while you hold steady, so it
            pauses if you are still settling.
          </p>
        </>
      )}

      {calibration && (
        <>
          <p className="ok">
            Calibrated — torso {calibration.torsoScale.toFixed(2)}, guard jitter L{" "}
            {calibration.guardJitter.left.toFixed(2)} / R{" "}
            {calibration.guardJitter.right.toFixed(2)}
          </p>
          {warnings.map((w) => (
            <p className="calib-warn" key={w}>
              {w}
            </p>
          ))}
        </>
      )}

      <div className="row">
        <button
          className="btn"
          onClick={() => startCalibration(stance)}
          disabled={!poseReady}
        >
          {calibration ? "Recalibrate" : "Calibrate"}
        </button>
        <button
          className="btn"
          onClick={() => setFighting(true)}
          disabled={!calibration}
        >
          Fight
        </button>
        <button className="btn" onClick={onExit}>
          Back
        </button>
      </div>

      {calibration && warnings.length > 0 && (
        <p className="muted small">
          You can fight through those warnings — unlike a measured run, a bad
          calibration here just makes the game feel wrong rather than corrupting
          a result.
        </p>
      )}

      <h3>Your punches</h3>
      <PunchGuideGrid stance={stance} />

      <h3>Camera check</h3>
      <p className="muted small">
        You should see your whole upper body, hips included. If you cannot see
        your hips here, the tracker cannot either.
      </p>
      <div className="selfview-large">
        <SelfView streamRef={streamRef} />
      </div>
    </div>
  );
}

/**
 * A small live view of the player's own camera.
 *
 * Attached to the SAME MediaStream the tracker uses rather than opening the
 * camera again — a second getUserMedia on one device fails or degrades on most
 * phones. Mirrored, because an unmirrored self-view is disorienting to move in.
 */
function SelfView({
  streamRef,
}: {
  streamRef: React.RefObject<MediaStream | null>;
}) {
  const ref = useRef<HTMLVideoElement>(null);
  useEffect(() => {
    const el = ref.current;
    const stream = streamRef.current;
    if (!el || !stream) return;
    el.srcObject = stream;
    void el.play().catch(() => {
      // Autoplay refusal on a muted inline video is unusual but not fatal —
      // this is a convenience view, not the tracked one.
    });
  }, [streamRef]);
  return <video ref={ref} className="selfview" playsInline muted />;
}
