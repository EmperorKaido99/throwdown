import { useCallback, useEffect, useRef, useState } from "react";
import { useWebcam } from "./capture/useWebcam";
import { usePoseTracking } from "./pose/usePoseTracking";
import { PoseOverlay } from "./ui/PoseOverlay";
import { DebugHud } from "./ui/DebugHud";
import { PunchHarness } from "./ui/PunchHarness";
import { PunchGuide } from "./ui/PunchGuide";
import { DodgeIndicator } from "./ui/DodgeIndicator";
import { MainMenu } from "./ui/shell/MainMenu";
import { HowToPlay } from "./ui/shell/HowToPlay";
import { SettingsScreen } from "./ui/shell/SettingsScreen";
import { FightScreen, FIGHT_READY } from "./ui/shell/FightScreen";
import { SCREEN_TITLES, type Screen } from "./ui/shell/screens";
import { loadSettings, saveSettings, type Settings } from "./config/settings";
import { captureRunContext } from "./debug/runContext";
import { NEUTRAL_HEAD_STATE, type HeadState } from "./perception/dodgeDetector";
import type { PunchType, Stance } from "./perception/punchTypes";
import "./App.css";
import "./ui/shell/shell.css";

// Root view. A menu shell wraps the Milestone 0/1 debug harness, which is
// reached unchanged from the Train screen. No networking yet — that follows the
// risk-first order in docs/02-IMPLEMENTATION-PLAN.md.

/**
 * `?screen=train` deep-links past the menu. The diagnostic and measurement
 * scripts in tools/ drive the app through Playwright and need to land on the
 * harness they are measuring without knowing the menu's DOM.
 */
function initialScreen(): Screen {
  const raw = new URLSearchParams(window.location.search).get("screen");
  const known: Screen[] = ["menu", "train", "fight", "howto", "settings"];
  return (known as string[]).includes(raw ?? "") ? (raw as Screen) : "menu";
}

export default function App() {
  const [screen, setScreen] = useState<Screen>(initialScreen);
  const [settings, setSettings] = useState<Settings>(loadSettings);

  // The camera latches on once the player enables it, rather than following the
  // current screen: re-creating the PoseLandmarker costs seconds of WASM init
  // and shader compilation, so bouncing to the menu and back must not pay it.
  // The header shows an always-visible indicator and a stop control, because a
  // webcam that stays live after you leave the screen has to be visible.
  const [cameraArmed, setCameraArmed] = useState(false);

  const { videoRef, status: camStatus, error: camError, info } = useWebcam(cameraArmed);
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
  } = usePoseTracking(videoRef, cameraArmed && camStatus === "ready");

  const updateSettings = useCallback((next: Settings) => {
    setSettings(next);
    saveSettings(next);
  }, []);

  // Snapshotted at the start and end of a measured run. docs/05 open question
  // 7b requires these recorded alongside a confusion matrix; collecting them
  // automatically is the only way that survives a player who is across the room
  // and has just thrown eighty punches.
  const captureContext = useCallback(
    () =>
      captureRunContext(info, delegate, frameIntervalStats.compute().median),
    [info, delegate, frameIntervalStats]
  );

  // Debug hook: lets measurement/diagnostic scripts inspect the live pose,
  // e.g. to find which landmark is failing a confidence gate.
  useEffect(() => {
    (window as unknown as Record<string, unknown>).__shadowboxPose = () =>
      poseRef.current;
  }, [poseRef]);

  // Diagnostic scripts drive the app without a mouse; without this they would
  // have to know the menu's DOM to reach the harness they actually measure.
  useEffect(() => {
    (window as unknown as Record<string, unknown>).__shadowboxGoto = (s: Screen) => {
      setScreen(s);
      if (s === "train") setCameraArmed(true);
    };
  }, []);

  // ?guides=1 renders the punch trajectory reference on its own, with no
  // camera or calibration. Useful for reviewing the diagrams, and for
  // screenshotting them in a diagnostic run.
  if (new URLSearchParams(window.location.search).has("guides")) {
    return <GuideGallery />;
  }

  if (screen === "menu") {
    return (
      <div className="shell">
        <MainMenu
          fightReady={FIGHT_READY}
          onNavigate={(s) => {
            setScreen(s);
            if (s === "train") setCameraArmed(true);
          }}
        />
      </div>
    );
  }

  return (
    <div className="shell">
      <header className="shell-head">
        <button className="shell-back" onClick={() => setScreen("menu")}>
          ← Menu
        </button>
        <h1 className="shell-title">{SCREEN_TITLES[screen]}</h1>
        {cameraArmed && (
          <div className="shell-cam">
            <span className="shell-cam-dot" aria-hidden="true" />
            <span>camera on</span>
            <button
              className="shell-cam-stop"
              onClick={() => setCameraArmed(false)}
            >
              stop
            </button>
          </div>
        )}
      </header>

      {screen === "fight" && <FightScreen />}
      {screen === "howto" && <HowToPlay />}
      {screen === "settings" && (
        <SettingsScreen
          settings={settings}
          onChange={updateSettings}
          delegate={delegate}
        />
      )}

      {/* The train view stays mounted once armed and is hidden rather than
          unmounted on other screens. Unmounting it would throw away the
          player's calibration, so a glance at How to play mid-session would
          cost a recalibration — and on a phone the player has to walk back to
          the device to redo it. */}
      {screen === "train" && !cameraArmed && (
        <CameraGate onEnable={() => setCameraArmed(true)} />
      )}
      {cameraArmed && (
        <div
          className="app app-wide"
          hidden={screen !== "train"}
          style={screen === "train" ? undefined : { display: "none" }}
        >
          <div
            className="stage"
            // Match the stage to the stream's real shape. A phone commonly
            // hands back a portrait stream, and a fixed 4:3 box crops it on
            // screen while MediaPipe still reads the whole frame — so the
            // player would be framing themselves against a view that is not
            // what is being tracked.
            style={
              info?.width && info?.height
                ? { aspectRatio: `${info.width} / ${info.height}` }
                : undefined
            }
          >
            <video ref={videoRef} className="video" playsInline muted />
            {settings.showSkeleton && (
              <PoseOverlay
                poseRef={poseRef}
                rawPoseRef={rawPoseRef}
                mirrored
                showRaw={settings.showRawSkeleton}
              />
            )}
          </div>

          <div className="panel">
            <PunchHarness
              poseRef={poseRef}
              enabled={poseStatus === "ready"}
              voicePrompts={settings.voicePrompts}
              onVoicePromptsChange={(v) =>
                updateSettings({ ...settings, voicePrompts: v })
              }
              captureContext={captureContext}
            />

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
                checked={settings.showRawSkeleton}
                onChange={(e) =>
                  updateSettings({
                    ...settings,
                    showRawSkeleton: e.target.checked,
                  })
                }
              />
              show unsmoothed skeleton (orange)
            </label>

            {camStatus === "denied" && (
              <p className="err">
                Camera permission denied. Allow access and reload.
              </p>
            )}
            {camError && camStatus !== "denied" && (
              <p className="err">{camError}</p>
            )}
            {errorMsg && <p className="err">pose: {errorMsg}</p>}
          </div>
        </div>
      )}
    </div>
  );
}

function CameraGate({ onEnable }: { onEnable: () => void }) {
  return (
    <div className="gate">
      <h1>Training</h1>
      <p className="gate-sub">Milestones 0–2 — pose, punches, dodging</p>
      <p className="gate-body">
        Grants camera access, runs MediaPipe Pose Landmarker locally, and
        measures the real pose sample rate on this machine. Nothing leaves the
        browser.
      </p>
      <button className="gate-btn" onClick={onEnable}>
        Enable camera
      </button>
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
