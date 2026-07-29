import { useCallback, useEffect, useRef, useState } from "react";
import {
  countRemaining,
  initialFight,
  isOver,
  stepFight,
  timeRemaining,
  type FightEvent,
  type FightState,
  type FighterInput,
  type FighterState,
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
import { ArenaCanvas } from "./Arena";
import { NEUTRAL_VIEW, type ArenaView } from "../../render/arena";
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
  // What the 3D scene should draw. Written by the simulation loop, read by the
  // renderer on its own frame — the two run at different rates by design.
  const arenaView = useRef<ArenaView>({ ...NEUTRAL_VIEW });

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

      arenaView.current = toArenaView(fight.current, keys.current, opponent);
      setDisplay(fight.current);
      if (landed.length > 0) applyFlash(landed, setFlash);
    };

    raf = requestAnimationFrame(frame);
    return () => cancelAnimationFrame(raf);
  }, [opponent]);

  const [p1, p2] = display.fighters;
  const over = isOver(display);
  const count = countRemaining(display);

  return (
    <div className="fight">
      <div className="fight-ring">
        <ArenaCanvas viewRef={arenaView} />

        <div className="fight-hud">
          <HealthBar
            label="You"
            fighter={p1}
            stunned={p1.stun > 0}
            align="left"
          />
          <div className="fight-clock-box">
            <div className="round-pips">
              {Array.from({ length: FIGHT_CONFIG.rounds }, (_, i) => (
                <span
                  key={i}
                  className={`round-pip${i + 1 === display.round ? " active" : ""}`}
                >
                  {i + 1}
                </span>
              ))}
            </div>
            <div className="fight-clock">{formatClock(display)}</div>
          </div>
          <HealthBar
            label={opponent === "scripted" ? "Sparring bot" : "Player 2"}
            fighter={p2}
            stunned={p2.stun > 0}
            align="right"
          />
        </div>
        {flash.p1 && (
          <div className={`ring-flash mine${flash.p1.startsWith("-") ? " hit" : " miss"}`}>
            {flash.p1}
          </div>
        )}
        {flash.p2 && (
          <div className={`ring-flash theirs${flash.p2.startsWith("-") ? " hit" : " miss"}`}>
            {flash.p2}
          </div>
        )}
        {count !== null && (
          <div className="fight-overlay">
            <div className="count-number">{count}</div>
            <div className="count-label">
              {display.fighters[0].down > 0 ? "You are down" : "Opponent is down"}
            </div>
          </div>
        )}
        {display.status === "roundBreak" && (
          <div className="fight-overlay">
            <div className="count-label">End of round {display.round}</div>
            <div className="count-number">{Math.ceil(timeRemaining(display))}</div>
          </div>
        )}
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
              Rounds {p1.roundsWon}–{p2.roundsWon} · knockdowns taken {p1.knockdowns}–
              {p2.knockdowns}
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

/** mm:ss, matching a ring clock rather than a bare second count. */
function formatClock(state: FightState): string {
  if (state.status !== "fighting") return "--:--";
  const total = Math.ceil(timeRemaining(state));
  const m = Math.floor(total / 60);
  const sec = total % 60;
  return `${m}:${String(sec).padStart(2, "0")}`;
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

/**
 * Stamina as ten discrete segments rather than a smooth bar.
 *
 * Segments make a single punch's cost legible at a glance — you can see that a
 * cross took one block and a counter uppercut took two — where a sliding bar
 * just shrinks. Segments beyond the fighter's current maximum are drawn as
 * permanently lost, so the price of a knockdown stays visible for the rest of
 * the bout.
 */
function HealthBar({
  label,
  fighter,
  stunned,
  align,
}: {
  label: string;
  fighter: FighterState;
  stunned: boolean;
  align: "left" | "right";
}) {
  const SEGMENTS = 10;
  const per = FIGHT_CONFIG.startingHealth / SEGMENTS;
  const filled = Math.ceil(fighter.health / per);
  const capacity = Math.round(fighter.maxHealth / per);
  const low = fighter.health <= fighter.maxHealth * 0.25;

  return (
    <div className={`hp hp-${align}`}>
      <div className="hp-label">
        {label}
        {stunned && <span className="hp-stun">STUNNED</span>}
        {fighter.roundsWon > 0 && (
          <span className="hp-rounds">{"\u25CF".repeat(fighter.roundsWon)}</span>
        )}
      </div>
      <div className="hp-segments">
        {Array.from({ length: SEGMENTS }, (_, i) => {
          const index = align === "right" ? SEGMENTS - 1 - i : i;
          const state =
            index >= capacity ? "lost" : index < filled ? "full" : "empty";
          return <span key={i} className={`hp-seg hp-seg-${state}${low && state === "full" ? " hp-seg-low" : ""}`} />;
        })}
      </div>
    </div>
  );
}


/**
 * Maps simulation state onto what the scene should draw.
 *
 * Head movement is read from the live keys rather than from the last simulated
 * tick, so leaning responds on the frame the key goes down instead of waiting
 * up to 16ms for a tick. Punches come from the simulation, because their timing
 * IS the game — a glove must arrive exactly when the punch resolves.
 */
function toArenaView(
  state: FightState,
  keys: Set<string>,
  opponent: Opponent
): ArenaView {
  const posture = (b: KeyBindings) => ({
    lean: keys.has(b.leanLeft) === keys.has(b.leanRight)
      ? 0
      : keys.has(b.leanLeft)
        ? -1
        : 1,
    duck: keys.has(b.duck) ? 1 : 0,
  });

  const inFlight = (index: 0 | 1) => {
    const p = state.fighters[index].pending[0];
    if (!p) return null;
    const remaining = p.resolvesAt - state.tick;
    return {
      hand: p.hand,
      progress: 1 - Math.max(0, remaining) / FIGHT_CONFIG.windupTicks,
    };
  };

  const you = posture(PLAYER1_KEYS);
  // A scripted opponent has no keys; its posture is read back from the same
  // deterministic function that drives it, one tick behind, which is close
  // enough for a display value.
  const them =
    opponent === "keyboard"
      ? posture(PLAYER2_KEYS)
      : (() => {
          const i = scriptedInput(state.tick);
          return { lean: i.lean, duck: i.duck };
        })();

  return {
    playerLean: you.lean,
    playerDuck: you.duck,
    playerStun: state.fighters[0].stun / FIGHT_CONFIG.stunTicks,
    playerPunch: inFlight(0),
    opponentLean: them.lean,
    opponentDuck: them.duck,
    opponentStun: state.fighters[1].stun / FIGHT_CONFIG.stunTicks,
    opponentPunch: inFlight(1),
  };
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
