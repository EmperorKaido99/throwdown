import { useEffect, useRef, useState } from "react";
import type { HeadState } from "../perception/dodgeDetector";

// Milestone 2's done-when is that dodging and ducking "visibly and promptly"
// move an on-screen indicator, with no noticeable false triggers. So this is
// the acceptance surface for that milestone, not just a debug readout — it
// shows the committed 0..1 values AND the raw measurements behind them, so a
// false trigger can be traced to which signal caused it.

interface Props {
  headStateRef: React.RefObject<HeadState>;
  /** Video is mirrored, so a dodge to the player's right appears left. */
  mirrored?: boolean;
}

const REFRESH_MS = 60;

export function DodgeIndicator({ headStateRef, mirrored = true }: Props) {
  const [state, setState] = useState<HeadState | null>(null);
  const frame = useRef(0);

  useEffect(() => {
    // Polls rather than re-rendering per pose frame: the head state updates at
    // the pose rate, and driving React that fast would make the perception
    // loop's cost depend on rendering. ~16 Hz is well past "prompt" for a
    // human watching an indicator.
    const id = setInterval(() => {
      frame.current++;
      setState(headStateRef.current ? { ...headStateRef.current } : null);
    }, REFRESH_MS);
    return () => clearInterval(id);
  }, [headStateRef]);

  if (!state) return null;

  const lean = mirrored ? -state.lean : state.lean;
  const dotX = 50 + lean * 42;
  const dotY = 34 + state.duck * 46;

  const label =
    state.duck > 0.45
      ? "DUCK"
      : Math.abs(state.lean) < 0.25
        ? "centre"
        : lean < 0
          ? "SLIP LEFT"
          : "SLIP RIGHT";

  return (
    <div className="dodge">
      <div className="dodge-head">
        <span>head position</span>
        <span className={state.tracked ? "muted" : "bad"}>
          {state.tracked ? "tracked" : "LOST"}
        </span>
      </div>

      <div className="dodge-field">
        {/* Neutral zone, so "am I inside the dead zone" is visible at a glance. */}
        <div className="dodge-neutral" />
        <div
          className="dodge-dot"
          style={{ left: `${dotX}%`, top: `${dotY}%` }}
        />
        <div className="dodge-axis dodge-axis-v" />
        <div className="dodge-axis dodge-axis-h" />
      </div>

      <div className={`dodge-label ${label === "centre" ? "muted" : "active"}`}>
        {label}
      </div>

      <table className="features">
        <tbody>
          <tr>
            <td className="muted">lean</td>
            <td>{state.lean.toFixed(2)}</td>
          </tr>
          <tr>
            <td className="muted">duck</td>
            <td>{state.duck.toFixed(2)}</td>
          </tr>
          <tr>
            <td className="muted">raw lateral</td>
            <td>{state.raw.lateral.toFixed(3)}</td>
          </tr>
          <tr>
            <td className="muted">raw head drop</td>
            <td>{state.raw.headDrop.toFixed(3)}</td>
          </tr>
          <tr>
            <td className="muted">raw body drop</td>
            <td>{state.raw.bodyDrop.toFixed(3)}</td>
          </tr>
        </tbody>
      </table>
    </div>
  );
}
