import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { PoseFrame } from "../pose/poseTypes";
import { usePunchDetection } from "../perception/usePunchDetection";
import { calibrationWarnings } from "../perception/calibration";
import type { PunchEvent, PunchType, Stance } from "../perception/punchTypes";
import {
  PUNCH_TYPES,
  checkBars,
  evaluate,
  formatReport,
  type Trial,
} from "../debug/confusionMatrix";
import { PERCEPTION_CONFIG } from "../config/tuning";
import { PunchGuide, PunchGuideGrid } from "./PunchGuide";
import { DodgeIndicator } from "./DodgeIndicator";
import { DetectionDiagnostics } from "./DetectionDiagnostics";
import { cancelSpeech, primeSpeech, speak, speechSupported } from "./speech";
import {
  LEAD_IN_SPEECH,
  blockIntro,
  blockIntroLines,
  handFor,
  repCue,
} from "../perception/punchScript";
import { useWakeLock } from "./useWakeLock";
import {
  formatRunConditions,
  type RunConditions,
  type RunContext,
} from "../debug/runContext";
import {
  clearRun,
  loadRun,
  saveRun,
  shareReport,
  type SavedRun,
} from "../debug/savedRun";

// Milestone 1 harness: webcam -> landmarks -> classifier -> on-screen label,
// plus a guided protocol that produces a real confusion matrix.
//
// The protocol runs hands-free on a fixed cadence. That is not a style choice:
// the player is standing back from the camera in a boxing stance, so anything
// requiring a click between reps would either not be collectable at all or
// would contaminate the trajectory data with reaching for the keyboard.

type Step = "calibrate" | "free" | "collect" | "results";

/** Which hand the protocol asks for, so lead/rear accuracy can be scored. */
const PROMPT_HAND: Record<PunchType, "lead" | "rear"> = {
  jab: "lead",
  cross: "rear",
  hook: "lead",
  uppercut: "rear",
};

/**
 * Protocol timing.
 *
 * THROW_MS is the capture window and is deliberately unchanged from run 2 —
 * it is the only one of these that the confusion matrix depends on. The rest
 * is preparation, and run 2 showed it was too short on a phone: the player taps
 * start, then has to walk back into frame, so the first trials were being
 * thrown mid-walk or not at all.
 */
const LEAD_IN_MS = 8000;
const ANNOUNCE_MS = 6000;
const READY_MS = 1800;
const THROW_MS = 2000;

interface Props {
  poseRef: React.RefObject<PoseFrame | null>;
  enabled: boolean;
  /** Speak each prompt aloud. Required in practice on a phone — see speech.ts. */
  voicePrompts: boolean;
  onVoicePromptsChange: (next: boolean) => void;
  /** Snapshot of device/camera/pose-rate conditions, stamped onto the report. */
  captureContext: () => RunContext;
}

export function PunchHarness({
  poseRef,
  enabled,
  voicePrompts,
  onVoicePromptsChange,
  captureContext,
}: Props) {
  const [step, setStep] = useState<Step>("calibrate");
  const [stance, setStance] = useState<Stance>("orthodox");
  const [repsPerType, setRepsPerType] = useState(20);

  const detection = usePunchDetection(poseRef, enabled);
  const { phase, calibration, calibrationProgress, lastPunch, startCalibration } =
    detection;
  const { diagnostics: diagnosticsRef, resetDiagnostics } = detection;

  // ---- free play: rolling log of recent punches ----
  const [recent, setRecent] = useState<PunchEvent[]>([]);
  // Depend on the stable `onPunch` callback, not the `detection` object, whose
  // identity changes every render — that re-subscribed on every render, and a
  // punch landing between cleanup and re-subscribe would have been dropped.
  const { onPunch } = detection;
  useEffect(() => {
    return onPunch((e) => {
      setRecent((prev) => [e, ...prev].slice(0, 8));
    });
  }, [onPunch]);

  // ---- guided collection ----
  const [trials, setTrials] = useState<Trial[]>([]);
  const [trialIndex, setTrialIndex] = useState(0);
  const [windowPhase, setWindowPhase] = useState<
    "leadin" | "announce" | "ready" | "throw"
  >("leadin");

  const schedule = useMemo(() => {
    const out: PunchType[] = [];
    for (const t of PUNCH_TYPES) {
      for (let i = 0; i < repsPerType; i++) out.push(t);
    }
    return out;
  }, [repsPerType]);

  // Captured punch for the trial currently in its throw window.
  //
  // `capturing` gates the subscriber to the throw window specifically. Without
  // it, an early punch thrown during the "get ready" countdown would sit in
  // `captured` and be recorded as the answer to the NEXT prompt — quietly
  // corrupting the confusion matrix rather than failing visibly.
  const captured = useRef<PunchEvent | null>(null);
  const capturing = useRef(false);
  useEffect(() => {
    return onPunch((e) => {
      if (capturing.current && !captured.current) captured.current = e;
    });
  }, [onPunch]);

  // Conditions the run happened under. Captured at the start and again at the
  // end so a thermal slowdown across a ~4.5 minute run is visible in the report
  // rather than being invisibly baked into the later trials.
  const [conditions, setConditions] = useState<RunConditions | null>(null);
  const [recovered, setRecovered] = useState(false);

  const startCollection = useCallback(() => {
    setTrials([]);
    setTrialIndex(0);
    setRecovered(false);
    setWindowPhase("leadin");
    captured.current = null;
    capturing.current = false;
    // Zero the gate counters so the report describes THIS run, not whatever
    // free practice happened before it.
    resetDiagnostics();
    setConditions({
      start: captureContext(),
      end: null,
      stance,
      repsPerType,
      torsoScale: calibration?.torsoScale ?? null,
      scaleSource: calibration?.scaleSource ?? null,
      calibrationWarnings: calibration ? calibrationWarnings(calibration) : [],
      diagnostics: null,
    });
    // iOS Safari only permits synthesis that was started from a user gesture,
    // and this click is the last one before the player steps back out of reach.
    if (voicePrompts) primeSpeech();
    setStep("collect");
  }, [voicePrompts, captureContext, stance, repsPerType, calibration, resetDiagnostics]);

  // The player never touches the device during a run, which on a phone is long
  // enough to hit auto-lock. Held across the whole harness, not just the run,
  // so calibration and free practice do not lock out either.
  useWakeLock(enabled);

  useEffect(() => {
    if (step !== "collect") return;
    if (trialIndex >= schedule.length) {
      setStep("results");
      return;
    }

    const current = schedule[trialIndex];
    const previous = trialIndex > 0 ? schedule[trialIndex - 1] : null;

    // Nothing is captured outside the throw window, in every phase below.
    if (windowPhase !== "throw") {
      capturing.current = false;
      captured.current = null;
    }

    if (windowPhase === "leadin") {
      if (voicePrompts) speak(LEAD_IN_SPEECH);
      const id = setTimeout(() => setWindowPhase("announce"), LEAD_IN_MS);
      return () => clearTimeout(id);
    }

    if (windowPhase === "announce") {
      // Long-form coaching happens here, once per block, where there is time
      // for it. Between reps there is not.
      if (voicePrompts) {
        speak(blockIntro(current, stance, repsPerType, previous), 1.0);
      }
      const id = setTimeout(() => setWindowPhase("ready"), ANNOUNCE_MS);
      return () => clearTimeout(id);
    }

    if (windowPhase === "ready") {
      // Naming the hand is the point: without it the player has to remember
      // that a jab is the lead hand and which of their hands leads, and a
      // lapse gets scored as a classifier error.
      if (voicePrompts) speak(repCue(current, stance));
      const id = setTimeout(() => setWindowPhase("throw"), READY_MS);
      return () => clearTimeout(id);
    }

    // Throw window open: start listening.
    capturing.current = true;
    captured.current = null;
    if (voicePrompts) speak("go", 1.4);

    // Throw window closed — record whatever was (or wasn't) detected.
    const id = setTimeout(() => {
      capturing.current = false;
      const e = captured.current;
      setTrials((prev) => [
        ...prev,
        {
          prompted: current,
          detected: e ? e.type : null,
          event: e,
          at: performance.now(),
        },
      ]);
      captured.current = null;
      const next = schedule[trialIndex + 1];
      setTrialIndex((i) => i + 1);
      // Only re-announce when the punch type actually changes.
      setWindowPhase(next !== undefined && next !== current ? "announce" : "ready");
    }, THROW_MS);
    return () => clearTimeout(id);
  }, [step, windowPhase, trialIndex, schedule, voicePrompts, stance, repsPerType]);

  const abortCollection = useCallback(() => {
    cancelSpeech();
    setStep(trials.length > 0 ? "results" : "free");
  }, [trials.length]);

  // A run that ends normally must not leave a queued "go" talking over the
  // results screen.
  useEffect(() => {
    if (step !== "collect") cancelSpeech();
  }, [step]);

  // Close out the run once, however it ended, and persist it immediately —
  // before the player has walked back to the device. Four and a half minutes of
  // punches should not be recoverable only from a screen that is still open.
  const finalised = useRef(false);
  useEffect(() => {
    if (step !== "results") {
      finalised.current = false;
      return;
    }
    if (finalised.current || trials.length === 0 || !conditions) return;
    finalised.current = true;
    const snapshot = diagnosticsRef.current;
    const closed: RunConditions = {
      ...conditions,
      end: captureContext(),
      // Deep-copied: the classifier keeps mutating its live diagnostics object,
      // so storing the reference would let the saved run drift after the fact.
      diagnostics: snapshot
        ? {
            ...snapshot,
            byReason: { ...snapshot.byReason },
            recent: [...snapshot.recent],
            peakSeen: {
              left: { ...snapshot.peakSeen.left },
              right: { ...snapshot.peakSeen.right },
            },
          }
        : null,
    };
    setConditions(closed);
    saveRun(trials, closed);
  }, [step, trials, conditions, captureContext, diagnosticsRef]);

  const recoverRun = useCallback((r: SavedRun) => {
    setTrials(r.trials);
    setConditions(r.conditions);
    setRecovered(true);
    // Already persisted; re-saving would overwrite its end conditions with this
    // session's, which were not the conditions the run was taken under.
    finalised.current = true;
    setStep("results");
  }, []);

  // Escape aborts a run without losing what's been collected so far.
  useEffect(() => {
    if (step !== "collect") return;
    const onKey = (ev: KeyboardEvent) => {
      if (ev.key === "Escape") abortCollection();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [step, abortCollection]);

  if (!enabled) return null;

  // ---------------- calibration ----------------
  if (step === "calibrate") {
    const pct = Math.min(
      100,
      (calibrationProgress / PERCEPTION_CONFIG.calibrationMinSamples) * 100
    );
    return (
      <div className="harness">
        <h2>Calibration</h2>
        <p className="muted">
          Stand in your boxing stance with hands up in guard, fully in frame
          from hips to head. Hold still while this samples your build.
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
        <p className="muted small">
          Stance is asked rather than detected — inferring it needs shoulder
          depth, and depth is the least reliable axis here.
        </p>

        {phase === "calibrating" && (
          <>
            <div className="bar">
              <div className="bar-fill" style={{ width: `${pct}%` }} />
            </div>
            <p className="muted small">
              {calibrationProgress} / {PERCEPTION_CONFIG.calibrationMinSamples} good
              frames
            </p>
            <TrackingChecklist statusRef={detection.landmarkStatus} />
          </>
        )}

        <RecoverLastRun onRecover={recoverRun} />

        {calibration ? (
          <>
            <p className="ok">
              Calibrated — torso scale {calibration.torsoScale.toFixed(3)}, guard
              extension L {calibration.guardExtension.left.toFixed(2)} / R{" "}
              {calibration.guardExtension.right.toFixed(2)}
            </p>
            <p className="muted small">
              scale reference: {calibration.scaleSource} · torso{" "}
              {calibration.torsoScale.toFixed(2)} · guard jitter L{" "}
              {calibration.guardJitter.left.toFixed(2)} / R{" "}
              {calibration.guardJitter.right.toFixed(2)}
            </p>
            {calibrationWarnings(calibration).map((w) => (
              <p className="calib-warn" key={w}>
                {w}
              </p>
            ))}
            <div className="row">
              <button onClick={() => setStep("free")}>Free practice</button>
              <button onClick={startCollection}>Start measured run</button>
            </div>
          </>
        ) : (
          <button onClick={() => startCalibration(stance)}>
            {phase === "calibrating" ? "Recalibrate" : "Begin calibration"}
          </button>
        )}
      </div>
    );
  }

  // ---------------- free practice ----------------
  if (step === "free") {
    return (
      <div className="harness">
        <h2>Free practice</h2>
        <p className="muted small">
          Throw punches and check the classifier reacts sensibly before spending
          five minutes on a measured run. Throw each one the way the guide shows
          — the measured run scores what you were asked for against what was
          detected, so matching the intended movement is what keeps the result
          meaningful.
        </p>

        <PunchGuideGrid stance={stance} />

        {/* Milestone 2 lives alongside free practice: dodge/duck is continuous
            state that should be checked while moving naturally, not measured
            in discrete prompted reps the way punches are. */}
        <DetectionDiagnostics
          diagnosticsRef={detection.diagnostics}
          onReset={detection.resetDiagnostics}
        />

        <DodgeIndicator headStateRef={detection.headState} />

        {lastPunch && <PunchGuide type={lastPunch.type} stance={stance} />}

        <div className="punch-readout">
          {lastPunch ? (
            <>
              <div className="punch-label">{lastPunch.type.toUpperCase()}</div>
              <div className="muted">
                {lastPunch.role} hand · confidence{" "}
                {(lastPunch.confidence * 100).toFixed(0)}%
              </div>
            </>
          ) : (
            <div className="muted">no punch detected yet</div>
          )}
        </div>

        {lastPunch && <FeatureTable event={lastPunch} />}

        <div className="log">
          {recent.map((e, i) => (
            <div key={`${e.timestamp}-${i}`} className="log-row">
              <span className="log-type">{e.type}</span>
              <span className="muted">
                {e.hand} · conf {(e.confidence * 100).toFixed(0)}% · in{" "}
                {e.features.inwardTravel.toFixed(2)} up{" "}
                {e.features.upwardTravel.toFixed(2)} curv{" "}
                {e.features.curvature.toFixed(2)} · {e.features.sampleCount}f
              </span>
            </div>
          ))}
        </div>

        <div className="row">
          <button onClick={() => setStep("calibrate")}>Back to calibration</button>
          <button onClick={startCollection}>Start measured run</button>
        </div>
        <label className="muted small">
          reps per punch type:{" "}
          <input
            type="number"
            min={5}
            max={40}
            value={repsPerType}
            onChange={(e) => setRepsPerType(Number(e.target.value) || 20)}
            style={{ width: 60 }}
          />
        </label>
        <label className="toggle">
          <input
            type="checkbox"
            checked={voicePrompts}
            disabled={!speechSupported()}
            onChange={(e) => onVoicePromptsChange(e.target.checked)}
          />
          speak each prompt aloud
        </label>
        <p className="muted small">
          {speechSupported()
            ? "Leave this on for a phone run — you will be too far back to read the screen, and a prompt you had to guess at scores your guessing, not the classifier."
            : "This browser has no speech synthesis, so prompts are visual only. Check you can read them from where you will be standing before starting a run."}
        </p>
      </div>
    );
  }

  // ---------------- guided collection ----------------
  if (step === "collect") {
    const current = schedule[trialIndex];
    const done = trialIndex;
    const next = schedule[trialIndex + 1];
    const previous = trialIndex > 0 ? schedule[trialIndex - 1] : null;

    if (windowPhase === "leadin") {
      return (
        <div className="harness collect">
          <div className="prompt-type">GET SET</div>
          <p className="muted">
            Stand back so your hips are in shot, hands up in guard. The first
            punch is called in a few seconds.
          </p>
          <button className="abort-btn" onClick={abortCollection}>
            Stop run
          </button>
        </div>
      );
    }

    if (windowPhase === "announce") {
      const intro = blockIntroLines(current, stance, repsPerType, previous);
      return (
        <div className="harness collect">
          <div className="muted">{done} / {schedule.length}</div>
          {intro.switching && <div className="switch-cue">SWITCH HANDS</div>}
          <div className="prompt-type">{intro.heading}</div>
          <div className="muted">{intro.hand}</div>
          <PunchGuide type={current} stance={stance} />
          <p className="muted small">{intro.cue}</p>
          <button className="abort-btn" onClick={abortCollection}>
            Stop run{trials.length > 0 ? ` (keep ${trials.length})` : ""}
          </button>
        </div>
      );
    }

    return (
      <div className="harness collect">
        <div className="muted">{done} / {schedule.length}</div>
        <div className="prompt-type">{current?.toUpperCase()}</div>
        <div className="prompt-hand">
          {handFor(current, stance).toUpperCase()} HAND
          <span className="muted small">
            {" "}
            ({PROMPT_HAND[current] === "lead" ? "lead" : "rear"})
          </span>
        </div>

        {current && <PunchGuide type={current} stance={stance} />}

        <div className={`prompt ${windowPhase}`}>
          {windowPhase === "ready" ? "get ready" : "THROW"}
        </div>

        <div className="muted small">
          Return to guard between reps — the detector re-arms from guard.
        </div>
        {next && next !== current && (
          <div className="muted small next-up">next up: {next}</div>
        )}

        {/* Esc is unreachable on a phone, where the player is also too far away
            to read anything — hence a large touch target and the spoken cues. */}
        <button className="abort-btn" onClick={abortCollection}>
          Stop run{trials.length > 0 ? ` (keep ${trials.length})` : ""}
        </button>
        <div className="muted small">or press Esc</div>
      </div>
    );
  }

  // ---------------- results ----------------
  return (
    <Results
      trials={trials}
      conditions={conditions}
      recovered={recovered}
      onRestart={startCollection}
      onFree={() => setStep("free")}
    />
  );
}

/**
 * Offers back the last completed run. Shown on the calibration screen because
 * that is where a reloaded phone lands, and the first instinct after losing a
 * result is to start throwing punches again rather than to look for it.
 */
function RecoverLastRun({ onRecover }: { onRecover: (r: SavedRun) => void }) {
  const [saved, setSaved] = useState(loadRun);
  if (!saved) return null;
  return (
    <div className="recover">
      <div className="muted small">
        An <strong>older</strong> run from{" "}
        {new Date(saved.savedAt).toLocaleString()} is still saved on this device
        ({saved.trials.length} trials, build{" "}
        {saved.conditions?.start?.build ?? "unknown"}). Viewing it does not
        re-run anything.
      </div>
      <div className="row">
        <button onClick={() => onRecover(saved)}>View that result</button>
        <button
          onClick={() => {
            clearRun();
            setSaved(null);
          }}
        >
          Discard
        </button>
      </div>
    </div>
  );
}

/**
 * Shows which required landmarks are actually tracked. Calibration silently
 * collecting zero frames is otherwise indistinguishable from a broken build —
 * in practice the cause is nearly always framing (hands below the frame, or
 * standing too close), which this makes obvious and fixable.
 */
function TrackingChecklist({
  statusRef,
}: {
  statusRef: React.RefObject<Record<string, number> | null>;
}) {
  const [status, setStatus] = useState<Record<string, number> | null>(null);
  useEffect(() => {
    const id = setInterval(() => setStatus(statusRef.current), 250);
    return () => clearInterval(id);
  }, [statusRef]);

  if (!status) return <p className="muted small">waiting for pose…</p>;
  const min = PERCEPTION_CONFIG.minLandmarkConfidence;

  return (
    <table className="features">
      <tbody>
        {Object.entries(status).map(([name, conf]) => {
          const optional = name.includes("optional");
          const good = conf >= min;
          return (
            <tr key={name}>
              <td className={good || optional ? "muted" : "bad"}>
                {good ? "ok" : optional ? "—" : "MISSING"}
              </td>
              <td className="muted">{name}</td>
              <td>{conf.toFixed(2)}</td>
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}

function FeatureTable({ event }: { event: PunchEvent }) {
  const f = event.features;
  const rows: [string, string][] = [
    ["inward travel", f.inwardTravel.toFixed(3)],
    ["upward travel", f.upwardTravel.toFixed(3)],
    ["extension gain", f.extensionGain.toFixed(3)],
    ["peak extension", f.peakExtension.toFixed(3)],
    ["elbow open", `${f.elbowAngleStart.toFixed(0)}° → ${f.elbowAnglePeak.toFixed(0)}°`],
    ["peak speed", f.peakSpeed.toFixed(2)],
    ["curvature", f.curvature.toFixed(3)],
    ["lowest height", f.lowestHeight.toFixed(3)],
    ["excursion", f.peakExcursion.toFixed(3)],
    ["duration", `${f.durationMs.toFixed(0)} ms`],
    ["samples", String(f.sampleCount)],
  ];
  return (
    <table className="features">
      <tbody>
        {rows.map(([k, v]) => (
          <tr key={k}>
            <td className="muted">{k}</td>
            <td>{v}</td>
          </tr>
        ))}
        <tr>
          <td className="muted">scores</td>
          <td>
            {PUNCH_TYPES.map((t) => `${t[0]}:${event.scores[t].toFixed(2)}`).join(" ")}
          </td>
        </tr>
      </tbody>
    </table>
  );
}

function Results({
  trials,
  conditions,
  recovered,
  onRestart,
  onFree,
}: {
  trials: Trial[];
  conditions: RunConditions | null;
  /** True when this is a stored run being viewed again, not one just thrown. */
  recovered: boolean;
  onRestart: () => void;
  onFree: () => void;
}) {
  const [shareState, setShareState] = useState<string | null>(null);
  const evaluation = useMemo(() => evaluate(trials), [trials]);
  const report = useMemo(
    () =>
      formatReport(evaluation) +
      (conditions ? `\n${formatRunConditions(conditions)}` : ""),
    [evaluation, conditions]
  );
  const bars = checkBars(evaluation);
  const allPass = bars.every((b) => b.pass);

  return (
    <div className="harness">
      <h2>Measured result</h2>
      {recovered && (
        <div className="recovered-banner">
          RECOVERED RUN — not thrown just now
          <div className="muted small">
            Taken {new Date(conditions?.start.at ?? "").toLocaleString()} on
            build {conditions?.start.build ?? "unknown"}. Sending this on is
            sending the old result again — start a new run for a fresh one.
          </div>
        </div>
      )}
      <div className={allPass ? "verdict ok" : "verdict fail"}>
        {allPass
          ? "Clears every pre-set bar"
          : `Fails ${bars.filter((b) => !b.pass).length} of ${bars.length} pre-set bars`}
      </div>

      <table className="bars">
        <tbody>
          {bars.map((b) => (
            <tr key={b.label}>
              <td>{b.pass ? "PASS" : "FAIL"}</td>
              <td>{b.label}</td>
              <td>{(b.value * 100).toFixed(0)}%</td>
              <td className="muted">bar {(b.bar * 100).toFixed(0)}%</td>
            </tr>
          ))}
        </tbody>
      </table>

      <pre className="report">{report}</pre>

      <div className="row">
        {/* Share first: on a phone the report has to leave the device, and the
            clipboard is not a route off it. */}
        <button
          onClick={async () => {
            const r = await shareReport(report);
            setShareState(
              r === "shared"
                ? "shared"
                : r === "copied"
                  ? "copied to clipboard"
                  : "could not share — select the text below and copy it"
            );
          }}
        >
          Share report
        </button>
        <button
          onClick={() =>
            navigator.clipboard?.writeText(
              JSON.stringify({ evaluation, trials, conditions }, null, 2)
            )
          }
        >
          Copy raw JSON
        </button>
        <button onClick={onRestart}>Run again</button>
        <button onClick={onFree}>Free practice</button>
      </div>
      {shareState && <p className="muted small">{shareState}</p>}
      <p className="muted small">
        This result is saved on this device and will be offered back on the
        calibration screen if the page reloads.
      </p>
    </div>
  );
}
