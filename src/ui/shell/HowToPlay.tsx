import { useState } from "react";
import { PunchGuide } from "../PunchGuide";
import type { PunchType, Stance } from "../../perception/punchTypes";

// Player-facing explanation of the four things the camera is actually reading:
// framing, guard, punch shape, head position. The framing section is not
// padding — a mis-framed player is the single most common cause of the tracker
// measuring the wrong thing, and it costs nothing to prevent.

export function HowToPlay() {
  const [stance, setStance] = useState<Stance>("orthodox");

  return (
    <div className="screen">
      <h2>How to play</h2>

      <section className="howto-section">
        <h3>1. Frame yourself properly</h3>
        <p>
          Stand back far enough that your <strong>hips are in shot</strong>, not
          just your head and shoulders.
        </p>
        <p className="muted">
          Everything the tracker measures is scaled by the size of your torso on
          screen, which is what lets two players of different heights and reach
          be measured the same way. It prefers shoulder-to-hip distance for that
          scale and falls back to shoulder width when your hips are cropped —
          and the fallback shrinks as you turn side-on into a boxing stance,
          which is exactly when you need it to be steady. Taller players sitting
          close to a laptop get cropped first, so step back or raise the camera.
        </p>
      </section>

      <section className="howto-section">
        <h3>2. Set your stance and calibrate</h3>
        <p>
          Pick orthodox (left hand leads) or southpaw (right hand leads), then
          hold your normal guard while calibration runs.
        </p>
        <p className="muted">
          Calibration records where <em>your</em> fists sit when guarding, how
          much they naturally drift while you hold still, and how big your torso
          is on screen. Punches are measured as travel away from your own guard,
          so a short player and a tall one with a longer reach produce
          comparable numbers. Both players should calibrate on their own machine
          — the numbers are personal, not shared.
        </p>
      </section>

      <section className="howto-section">
        <h3>3. Throw at the camera</h3>
        <p>
          Punch toward the lens, the way you would toward an opponent standing
          in front of you. Return to guard between punches — the return is how
          the tracker knows the punch ended.
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
          Diagrams are mirrored to match the camera preview, so your lead hand is
          on the same side in both.
        </p>
        <div className="guide-grid">
          {(["jab", "cross", "hook", "uppercut"] as PunchType[]).map((t) => (
            <div key={t}>
              <div className="guide-title">{t.toUpperCase()}</div>
              <PunchGuide type={t} stance={stance} />
            </div>
          ))}
        </div>
        <p className="muted small">
          A straight punch thrown at the lens grows in frame rather than moving
          across it. That is the least intuitive thing to show on a flat diagram
          and the easiest thing to get wrong.
        </p>
      </section>

      <section className="howto-section">
        <h3>4. Move your head to defend</h3>
        <p>
          Lean left or right to slip, drop your head or bend your knees to duck.
        </p>
        <p className="muted">
          Head position is read continuously rather than as separate "dodge"
          moves, and it is measured against your own shoulder line — so stepping
          sideways does not read as a slip, because your shoulders travel with
          your head.
        </p>
      </section>
    </div>
  );
}
