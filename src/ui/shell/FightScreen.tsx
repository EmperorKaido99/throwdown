import { useState } from "react";
import { FightView, type Opponent } from "../fight/FightView";
import { CameraFight } from "../fight/CameraFight";
import type { PoseFrame } from "../../pose/poseTypes";
import "../fight/fight.css";

// Milestone 3 is playable; Milestones 4-5 (networked play) are not. The screen
// says which is which rather than hiding what does not exist.
//
// ONLINE_READY is the single flag the menu and this screen read. When the
// signaling server and delay-based netcode land, flip it and add the mode.

export const ONLINE_READY = false;
/** At least one fight mode is playable, so the menu no longer locks Fight. */
export const FIGHT_READY = true;

type GateState = "done" | "blocked" | "waiting";

interface Gate {
  id: string;
  milestone: string;
  title: string;
  state: GateState;
  note: string;
}

const ONLINE_GATES: Gate[] = [
  {
    id: "SB-006",
    milestone: "Milestone 3",
    title: "Fight simulation",
    state: "done",
    note:
      "Deterministic, side-effect-free, and playable below. Punch-set agnostic, " +
      "so it survives whatever Milestone 1 decides about punch typing.",
  },
  {
    id: "SB-001",
    milestone: "Milestone 1",
    title: "Camera input driving the fight",
    state: "done",
    note:
      "Wired: punch events and head state drive the fight directly. Whether " +
      "detection is RELIABLE is still unmeasured — but that now shows up as the " +
      "game feeling unresponsive, which is a more useful signal than a matrix.",
  },
  {
    id: "SB-008",
    milestone: "Milestone 4",
    title: "Signaling server and a WebRTC data channel",
    state: "waiting",
    note:
      "Room create/join and SDP/ICE relay only — no gameplay data passes " +
      "through it. Needs its own host; static hosting cannot hold a socket open.",
  },
  {
    id: "SB-009",
    milestone: "Milestone 5",
    title: "Punch and dodge events over the network",
    state: "waiting",
    note: "Delay-based netcode first, not rollback. This is the MVP target.",
  },
];

const STATE_LABEL: Record<GateState, string> = {
  done: "done",
  blocked: "blocked",
  waiting: "not started",
};

interface Props {
  poseRef: React.RefObject<PoseFrame | null>;
  poseReady: boolean;
  streamRef: React.RefObject<MediaStream | null>;
  /** Turns the camera on. The fight screen does not own it — App does. */
  onNeedCamera: () => void;
}

type Mode = "camera" | "scripted" | "keyboard";

export function FightScreen({
  poseRef,
  poseReady,
  streamRef,
  onNeedCamera,
}: Props) {
  const [mode, setMode] = useState<Mode | null>(null);

  if (mode === "camera") {
    return (
      <CameraFight
        poseRef={poseRef}
        poseReady={poseReady}
        streamRef={streamRef}
        opponent="scripted"
        onExit={() => setMode(null)}
      />
    );
  }
  if (mode) {
    return (
      <FightView opponent={mode as Opponent} onExit={() => setMode(null)} />
    );
  }

  return (
    <div className="screen">
      <h2>Fight</h2>
      <p className="screen-lead">
        The fight itself works. What is not wired up yet is your camera driving
        it, and playing against someone on another device.
      </p>

      <div className="mode-list">
        <button
          className="mode-item"
          onClick={() => {
            onNeedCamera();
            setMode("camera");
          }}
        >
          <span className="mode-item-label">Camera vs sparring bot</span>
          <span className="mode-item-detail">
            Throw real punches. Lean to slip, drop or crouch to duck. This is
            the MVP — the same fight, driven by your body instead of keys.
          </span>
        </button>

        <button className="mode-item" onClick={() => setMode("scripted")}>
          <span className="mode-item-label">Keyboard vs sparring bot</span>
          <span className="mode-item-detail">
            One player, keyboard. A scripted opponent that throws and defends on
            a fixed pattern — good for learning the timing.
          </span>
        </button>

        <button className="mode-item" onClick={() => setMode("keyboard")}>
          <span className="mode-item-label">Two players, one keyboard</span>
          <span className="mode-item-detail">
            Hot seat. You take the left of the keyboard, your opponent the
            right. This is the mode to test whether the fight is any fun.
          </span>
        </button>

        <button className="mode-item" disabled>
          <span className="mode-item-label">
            Online 1v1
            <span className="menu-badge">locked</span>
          </span>
          <span className="mode-item-detail">
            Two devices, each player throwing real punches at their own camera.
            See below for what it is waiting on.
          </span>
        </button>
      </div>

      <h3>What online play still needs</h3>
      <ol className="gates">
        {ONLINE_GATES.map((g) => (
          <li key={g.id} className={`gate-row gate-${g.state}`}>
            <div className="gate-head">
              <span className="gate-milestone">{g.milestone}</span>
              <span className="gate-id">{g.id}</span>
              <span className={`gate-state gate-state-${g.state}`}>
                {STATE_LABEL[g.state]}
              </span>
            </div>
            <div className="gate-title">{g.title}</div>
            <p className="gate-note">{g.note}</p>
          </li>
        ))}
      </ol>
    </div>
  );
}
