// The fight flow does not exist yet. Rather than hide the entry, this screen
// states exactly what it is waiting on, in the order 02-IMPLEMENTATION-PLAN.md
// requires. When a gate clears, tick it here and in memorybank/ticket-progress.md.
//
// FIGHT_READY flips to true only when every gate below is done. It is the single
// flag the menu reads, so wiring the real fight flow in later is a one-line
// change here plus the screen that replaces this one.

export const FIGHT_READY = false;

type GateState = "done" | "blocked" | "waiting";

interface Gate {
  id: string;
  milestone: string;
  title: string;
  state: GateState;
  note: string;
}

const GATES: Gate[] = [
  {
    id: "SB-001",
    milestone: "Milestone 1",
    title: "Punch detection and typing, measured on real punches",
    state: "blocked",
    note:
      "Needs a person throwing ~20 labelled reps of each punch into the camera. " +
      "The first run detected only 19% of punches; detection has been redesigned " +
      "since but has never been tried on a real thrown punch. No amount of code " +
      "clears this gate — only a session in front of the webcam.",
  },
  {
    id: "SB-002",
    milestone: "Milestone 2",
    title: "Dodging validated against ordinary movement",
    state: "blocked",
    note:
      "Head lean/duck detection is built and unit-tested. What is unverified is " +
      "that looking around, swaying and stepping do not false-trigger it.",
  },
  {
    id: "SB-006",
    milestone: "Milestone 3",
    title: "Local hot-seat fight simulation",
    state: "waiting",
    note:
      "Health, guard, hit windows, win/loss — as a pure (state, input) → state " +
      "function, which rollback later depends on. Gated behind Milestone 1 " +
      "because a rescoped punch set changes the hit table.",
  },
  {
    id: "SB-008",
    milestone: "Milestone 4",
    title: "Signaling server and a WebRTC data channel",
    state: "waiting",
    note: "Room create/join and SDP/ICE relay only. No gameplay data passes through it.",
  },
  {
    id: "SB-009",
    milestone: "Milestone 5",
    title: "Punch and dodge events over the LAN",
    state: "waiting",
    note:
      "Delay-based netcode first, not rollback. This is the first genuinely " +
      "playable version — the MVP target.",
  },
];

const STATE_LABEL: Record<GateState, string> = {
  done: "done",
  blocked: "blocked on a real session",
  waiting: "not started",
};

export function FightScreen() {
  return (
    <div className="screen">
      <h2>Fight — not built yet</h2>
      <p className="screen-lead">
        Two players, one each on their own machine, throwing real punches at
        their own webcam. Nothing crosses the network except the punch and dodge
        events each player's camera produced.
      </p>
      <p className="muted">
        The order below is deliberate. A fun prototype built on unreliable punch
        recognition has to be rewritten, so recognition is proven first.
      </p>

      <ol className="gates">
        {GATES.map((g) => (
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

      <p className="screen-foot">
        The two blocked gates are the whole critical path, and both clear in the
        same session: open <strong>Train</strong>, calibrate, and run the guided
        measurement.
      </p>
    </div>
  );
}
