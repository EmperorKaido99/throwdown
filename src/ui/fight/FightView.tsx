import { useCallback, useEffect, useRef, useState } from "react";
import {
  initialFight,
  stepFight,
  timeRemaining,
  type FightEvent,
  type FightState,
  type FighterInput,
} from "../../simulation/fightSim";
import {
  PLAYER1_KEYS,
  PLAYER2_KEYS,
  keyboardInput,
  scriptedInput,
  type KeyBindings,
} from "../../simulation/inputSources";
import { FIGHT_CONFIG } from "../../config/tuning";
import type { PunchType } from "../../perception/punchTypes";
import "./fight.css";

// Milestone 3's playable surface: a real fight, driven by the keyboard.
//
// Deliberately no camera. The question this screen answers is "does the FIGHT
// work" — timing, damage, whether defence feels worth doing — which is a
// separate question from whether pose tracking works, and has been unanswerable
// while the two were tangled together.

export type Opponent = "scripted" | "keyboard";

const TICK_MS = 1000 / FIGHT_CONFIG.tickRate;
/** Never simulate more than this many ticks in one frame after a stall. */
const MAX_CATCHUP_TICKS = 10;

interface Props {
  opponent: Opponent;
  onExit: () => void;
}

export function FightView({ opponent, onExit }: Props) {
  const [display, setDisplay] = useState<FightState>(initialFight);
  const [flash, setFlash] = useState<{ p1: string | null; p2: string | null }>({
    p1: null,
    p2: null,
  });

  // Authoritative state lives in a ref. React state is a per-frame snapshot for
  // rendering only — driving the simulation from setState would tie the tick
  // rate to React's scheduling, and the sim must advance at a fixed rate.
  const fight = useRef<FightState>(initialFight());
  const keys = useRef<Set<string>>(new Set());
  const queued = useRef<{ p1: PunchType | null; p2: PunchType | null }>({
    p1: null,
    p2: null,
  });
  const running = useRef(true);

  const reset = useCallback(() => {
    fight.current = initialFight();
    queued.current = { p1: null, p2: null };
    setDisplay(fight.current);
    running.current = true;
  }, []);

  // --- keyboard ---------------------------------------------------------
  useEffect(() => {
    const queueFor = (b: KeyBindings, slot: "p1" | "p2", key: string) => {
      const punch = b.punches[key];
      if (punch && !queued.current[slot]) queued.current[slot] = punch;
    };

    const down = (e: KeyboardEvent) => {
      const key = e.key.toLowerCase();
      // Arrow keys scroll the page; a fight is not a document.
      if (key.startsWith("arrow") || key === " ") e.preventDefault();
      keys.current.add(key);
      queueFor(PLAYER1_KEYS, "p1", key);
      if (opponent === "keyboard") queueFor(PLAYER2_KEYS, "p2", key);
    };
    const up = (e: KeyboardEvent) => keys.current.delete(e.key.toLowerCase());
    // A window that loses focus keeps its keys "held" forever otherwise, which
    // pins a permanent slip and makes the fight unwinnable.
    const blur = () => keys.current.clear();

    window.addEventListener("keydown", down);
    window.addEventListener("keyup", up);
    window.addEventListener("blur", blur);
    return () => {
      window.removeEventListener("keydown", down);
      window.removeEventListener("keyup", up);
      window.removeEventListener("blur", blur);
    };
  }, [opponent]);

  // --- fixed-timestep loop ----------------------------------------------
  useEffect(() => {
    let raf = 0;
    let last = performance.now();
    let accumulator = 0;

    const frame = (now: number) => {
      raf = requestAnimationFrame(frame);
      const elapsed = now - last;
      last = now;
      if (!running.current) return;

      // Clamped so a backgrounded tab does not fast-forward the whole round on
      // its way back. Real time is discarded; the simulation only ever sees
      // whole ticks.
      accumulator = Math.min(accumulator + elapsed, TICK_MS * MAX_CATCHUP_TICKS);

      const landed: FightEvent[] = [];
      while (accumulator >= TICK_MS) {
        accumulator -= TICK_MS;
        const state = fight.current;

        const p1: FighterInput = keyboardInput(
          keys.current,
          PLAYER1_KEYS,
          queued.current.p1
        );
        const p2: FighterInput =
          opponent === "scripted"
            ? scriptedInput(state.tick)
            : keyboardInput(keys.current, PLAYER2_KEYS, queued.current.p2);
        queued.current = { p1: null, p2: null };

        const next = stepFight(state, [p1, p2]);
        fight.current = next;
        landed.push(...next.events);
        if (next.status !== "fighting") {
          running.current = false;
          break;
        }
      }

      setDisplay(fight.current);
      if (landed.length > 0) applyFlash(landed, setFlash);
    };

    raf = requestAnimationFrame(frame);
    return () => cancelAnimationFrame(raf);
  }, [opponent]);

  const [p1, p2] = display.fighters;
  const over = display.status !== "fighting";

  return (
    <div className="fight">
      <div className="fight-hud">
        <HealthBar
          label="You"
          health={p1.health}
          stunned={p1.stun > 0}
          align="left"
        />
        <div className="fight-clock">
          {over ? "—" : Math.ceil(timeRemaining(display))}
        </div>
        <HealthBar
          label={opponent === "scripted" ? "Sparring bot" : "Player 2"}
          health={p2.health}
          stunned={p2.stun > 0}
          align="right"
        />
      </div>

      <div className="fight-ring">
        <Fighter
          side="left"
          state={display}
          index={0}
          flash={flash.p1}
          keys={keys}
        />
        <Fighter
          side="right"
          state={display}
          index={1}
          flash={flash.p2}
          keys={keys}
        />
        {over && (
          <div className="fight-result">
            <div className="fight-result-title">
              {display.status === "player1"
                ? "You win"
                : display.status === "player2"
                  ? opponent === "scripted"
                    ? "The bot wins"
                    : "Player 2 wins"
                  : "Draw"}
            </div>
            <div className="muted small">
              {p1.landed} landed / {p1.thrown} thrown · {p1.evaded} evaded
            </div>
            <button className="btn" onClick={reset}>
              Rematch
            </button>
          </div>
        )}
      </div>

      <Controls opponent={opponent} />

      <div className="row">
        <button className="btn" onClick={reset}>
          Restart
        </button>
        <button className="btn" onClick={onExit}>
          Leave fight
        </button>
      </div>
    </div>
  );
}

function applyFlash(
  events: readonly FightEvent[],
  setFlash: (f: { p1: string | null; p2: string | null }) => void
) {
  let p1: string | null = null;
  let p2: string | null = null;
  for (const e of events) {
    // `by` is the attacker, so feedback lands on the other fighter.
    if (e.kind === "landed") {
      if (e.by === 0) p2 = `-${e.damage}`;
      else p1 = `-${e.damage}`;
    } else if (e.kind === "evaded") {
      if (e.by === 0) p2 = e.how === "slip" ? "SLIP" : "DUCK";
      else p1 = e.how === "slip" ? "SLIP" : "DUCK";
    }
  }
  if (p1 || p2) {
    setFlash({ p1, p2 });
    setTimeout(() => setFlash({ p1: null, p2: null }), 450);
  }
}

function HealthBar({
  label,
  health,
  stunned,
  align,
}: {
  label: string;
  health: number;
  stunned: boolean;
  align: "left" | "right";
}) {
  const pct = (health / FIGHT_CONFIG.startingHealth) * 100;
  return (
    <div className={`hp hp-${align}`}>
      <div className="hp-label">
        {label}
        {stunned && <span className="hp-stun">STUNNED</span>}
      </div>
      <div className="hp-track">
        <div
          className={`hp-fill${pct <= 25 ? " hp-low" : ""}`}
          style={{ width: `${Math.max(0, pct)}%` }}
        />
      </div>
    </div>
  );
}

function Fighter({
  side,
  state,
  index,
  flash,
  keys,
}: {
  side: "left" | "right";
  state: FightState;
  index: 0 | 1;
  flash: string | null;
  keys: React.RefObject<Set<string>>;
}) {
  const f = state.fighters[index];
  const throwing = f.pending.length > 0;

  // Player 1's posture reads from the live keys so it responds on the frame the
  // key goes down, rather than waiting for the input to survive a tick.
  const bindings = index === 0 ? PLAYER1_KEYS : PLAYER2_KEYS;
  const held = keys.current ?? new Set<string>();
  const leaning = held.has(bindings.leanLeft)
    ? -1
    : held.has(bindings.leanRight)
      ? 1
      : 0;
  const ducking = held.has(bindings.duck);

  return (
    <div className={`fighter fighter-${side}`}>
      <div
        className={`fighter-body${throwing ? " is-throwing" : ""}${
          f.stun > 0 ? " is-stunned" : ""
        }`}
        style={{
          transform: `translateX(${leaning * 18}px) translateY(${
            ducking ? 22 : 0
          }px)`,
        }}
      >
        <div className="fighter-head" />
        <div className="fighter-torso" />
      </div>
      {flash && (
        <div className={`fighter-flash${flash.startsWith("-") ? " hit" : " miss"}`}>
          {flash}
        </div>
      )}
    </div>
  );
}

function Controls({ opponent }: { opponent: Opponent }) {
  return (
    <div className="fight-controls">
      <div>
        <div className="hud-label">You</div>
        <kbd>Q</kbd> jab · <kbd>W</kbd> cross · <kbd>E</kbd> hook ·{" "}
        <kbd>R</kbd> uppercut
        <br />
        <kbd>A</kbd>/<kbd>D</kbd> slip left/right · <kbd>S</kbd> duck
      </div>
      {opponent === "keyboard" && (
        <div>
          <div className="hud-label">Player 2</div>
          <kbd>U</kbd> jab · <kbd>I</kbd> cross · <kbd>O</kbd> hook ·{" "}
          <kbd>P</kbd> uppercut
          <br />
          <kbd>←</kbd>/<kbd>→</kbd> slip · <kbd>↓</kbd> duck
        </div>
      )}
      <p className="muted small">
        A punch takes {FIGHT_CONFIG.windupTicks} ticks to land, so a slip or
        duck started after it was thrown still beats it. Ducking under an
        uppercut costs you.
      </p>
    </div>
  );
}
