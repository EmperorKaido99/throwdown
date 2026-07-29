import type { Screen } from "./screens";

// Main menu. Entries are deliberately punch-set agnostic — nothing here names
// jab/cross/hook/uppercut, because Milestone 1's measurement may yet reduce the
// punch set (02-IMPLEMENTATION-PLAN.md decision point) and the menu should not
// need rewriting when it does.

interface Props {
  onNavigate: (screen: Screen) => void;
  /** Fight is gated on Milestone 3; see FightScreen for the live gate list. */
  fightReady: boolean;
}

interface Entry {
  screen: Screen;
  label: string;
  detail: string;
  locked?: boolean;
}

export function MainMenu({ onNavigate, fightReady }: Props) {
  const entries: Entry[] = [
    {
      screen: "train",
      label: "Train",
      detail: "Calibrate, practise freely, or run a measured accuracy session",
    },
    {
      screen: "fight",
      label: "Fight",
      detail: fightReady
        ? "Sparring bot, or two players on one keyboard"
        : "Not built yet — see what it's waiting on",
      locked: !fightReady,
    },
    {
      screen: "howto",
      label: "How to play",
      detail: "Stance, guard, punch shapes, and dodging",
    },
    {
      screen: "settings",
      label: "Settings",
      detail: "Display and diagnostics",
    },
  ];

  return (
    <div className="menu">
      <header className="menu-head">
        <h1>Shadow Box</h1>
        <p className="menu-tag">Webcam boxing. Everything runs on your machine.</p>
      </header>

      <nav className="menu-list">
        {entries.map((e) => (
          <button
            key={e.screen}
            className={`menu-item${e.locked ? " menu-item-locked" : ""}`}
            onClick={() => onNavigate(e.screen)}
          >
            <span className="menu-item-label">
              {e.label}
              {e.locked && <span className="menu-badge">locked</span>}
            </span>
            <span className="menu-item-detail">{e.detail}</span>
          </button>
        ))}
      </nav>

      <footer className="menu-foot">
        <p>
          Your camera feed never leaves this device. Pose tracking runs locally
          in the browser.
        </p>
      </footer>
    </div>
  );
}
