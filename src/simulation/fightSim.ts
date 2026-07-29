import { FIGHT_CONFIG as F } from "../config/tuning";
import type { HandSide, PunchType } from "../perception/punchTypes";

// Milestone 3 — the fight itself.
//
// This module is a PURE FUNCTION of (state, input) -> state. No wall clock, no
// randomness, no I/O, no reads of the perception layer. That is not tidiness:
// rollback netcode (Milestone 6) works by re-running past ticks with corrected
// input, which is only sound if replaying the same ticks with the same inputs
// gives the same result. Every shortcut here costs that property.
//
// It is also deliberately punch-set agnostic. Damage is keyed by punch type,
// but nothing requires all four types to exist. If detection ends up able to
// report only "a punch happened", pass the same type every time and the fight
// still works — see 02-IMPLEMENTATION-PLAN.md's descope options.

export type PlayerIndex = 0 | 1;

/** What one fighter is doing on one tick. This is what crosses the network. */
export interface FighterInput {
  /** A punch thrown on this tick, or null. */
  punch: { type: PunchType; hand: HandSide } | null;
  /** Head lean, -1 (their left) .. +1 (their right). */
  lean: number;
  /** Head duck, 0 (upright) .. 1 (fully ducked). */
  duck: number;
}

export type FightInput = readonly [FighterInput, FighterInput];

/** A punch in flight — thrown, not yet resolved. */
export interface PendingPunch {
  type: PunchType;
  hand: HandSide;
  /** Tick at which this resolves against the defender's head state. */
  resolvesAt: number;
}

export interface FighterState {
  health: number;
  /** Ticks remaining before this fighter can throw again. */
  recovery: number;
  /** Ticks remaining of hit stun. */
  stun: number;
  pending: readonly PendingPunch[];
  thrown: number;
  landed: number;
  evaded: number;
}

export type FightStatus = "fighting" | "player1" | "player2" | "draw";

export interface FightState {
  tick: number;
  fighters: readonly [FighterState, FighterState];
  status: FightStatus;
  /** Punches that resolved on this tick, for rendering and audio. */
  events: readonly FightEvent[];
}

export type FightEvent =
  | { kind: "thrown"; by: PlayerIndex; type: PunchType; hand: HandSide }
  | {
      kind: "landed";
      by: PlayerIndex;
      type: PunchType;
      hand: HandSide;
      damage: number;
    }
  | { kind: "evaded"; by: PlayerIndex; type: PunchType; how: "slip" | "duck" }
  | { kind: "ko"; winner: PlayerIndex }
  | { kind: "timeUp"; winner: FightStatus };

export const NEUTRAL_INPUT: FighterInput = { punch: null, lean: 0, duck: 0 };

function freshFighter(): FighterState {
  return {
    health: F.startingHealth,
    recovery: 0,
    stun: 0,
    pending: [],
    thrown: 0,
    landed: 0,
    evaded: 0,
  };
}

export function initialFight(): FightState {
  return {
    tick: 0,
    fighters: [freshFighter(), freshFighter()],
    status: "fighting",
    events: [],
  };
}

/**
 * Does the defender's head beat this punch?
 *
 * Read at the RESOLVING tick, not the throwing tick. A dodge started after the
 * punch was thrown should still work — that is what makes defence feel active
 * rather than precognitive, and it is why head state is carried as continuous
 * state rather than as discrete "dodged" events (03-GESTURE-CLASSIFICATION.md).
 */
function evasion(
  punch: PendingPunch,
  defender: FighterInput
): "slip" | "duck" | null {
  // An uppercut comes up under the guard, so ducking feeds it. Every other
  // punch is ducked under.
  if (punch.type !== "uppercut" && defender.duck >= F.duckUnder) return "duck";

  // Straights travel down the centre and are slipped laterally. A hook travels
  // across, so leaning is a poor answer to it — ducking is the answer, handled
  // above.
  const straight = punch.type === "jab" || punch.type === "cross";
  if (straight && Math.abs(defender.lean) >= F.slipLean) return "slip";

  return null;
}

function damageFor(punch: PendingPunch, defender: FighterState, ducking: boolean) {
  let dmg = F.damage[punch.type] ?? F.damage.jab;
  if (punch.type === "uppercut" && ducking) dmg *= F.uppercutDuckPenalty;
  if (defender.stun > 0) dmg *= F.stunnedDamageMultiplier;
  return Math.round(dmg);
}

/**
 * Advances the fight by exactly one tick.
 *
 * Both fighters are resolved from the SAME input snapshot, and neither sees the
 * other's post-tick state — otherwise player 0 would gain an advantage purely
 * by being resolved first, and a rollback replaying in a different order could
 * diverge.
 */
export function stepFight(state: FightState, input: FightInput): FightState {
  if (state.status !== "fighting") return { ...state, events: [] };

  const tick = state.tick + 1;
  const events: FightEvent[] = [];

  // Work on copies; nothing below mutates `state`. The public type keeps
  // `pending` readonly so callers cannot corrupt a state they were handed —
  // this local view is the only place it is built up.
  type Mutable = Omit<FighterState, "pending"> & { pending: PendingPunch[] };
  const next: Mutable[] = state.fighters.map((f) => ({
    ...f,
    pending: [...f.pending],
  }));

  // --- 1. Throws -------------------------------------------------------
  for (const i of [0, 1] as const) {
    const me = next[i];
    const cmd = input[i].punch;
    if (!cmd) continue;
    // Stun and recovery both suppress a throw. The perception layer will keep
    // reporting punches while the fighter is staggered; the fight decides
    // whether they count.
    if (me.recovery > 0 || me.stun > 0) continue;

    me.pending.push({
      type: cmd.type,
      hand: cmd.hand,
      resolvesAt: tick + F.windupTicks,
    });
    me.recovery = F.recoveryTicks;
    me.thrown += 1;
    events.push({ kind: "thrown", by: i, type: cmd.type, hand: cmd.hand });
  }

  // --- 2. Resolutions --------------------------------------------------
  // Damage is accumulated and applied after both sides resolve, so a double
  // knockout is a draw rather than a win for whoever is checked first.
  const damageTaken: [number, number] = [0, 0];
  const stunApplied: [boolean, boolean] = [false, false];

  for (const i of [0, 1] as const) {
    const attacker = next[i];
    const defenderIndex = (1 - i) as PlayerIndex;
    const defenderInput = input[defenderIndex];
    const defender = next[defenderIndex];

    const stillPending: PendingPunch[] = [];
    for (const p of attacker.pending) {
      if (p.resolvesAt > tick) {
        stillPending.push(p);
        continue;
      }

      const dodged = evasion(p, defenderInput);
      if (dodged) {
        attacker.evaded += 1;
        events.push({ kind: "evaded", by: i, type: p.type, how: dodged });
        continue;
      }

      const dmg = damageFor(p, defender, defenderInput.duck >= F.duckUnder);
      damageTaken[defenderIndex] += dmg;
      stunApplied[defenderIndex] = true;
      attacker.landed += 1;
      events.push({ kind: "landed", by: i, type: p.type, hand: p.hand, damage: dmg });
    }
    attacker.pending = stillPending;
  }

  // --- 3. Timers and damage -------------------------------------------
  for (const i of [0, 1] as const) {
    const f = next[i];
    f.recovery = Math.max(0, f.recovery - 1);
    f.stun = Math.max(0, f.stun - 1);
    if (damageTaken[i] > 0) f.health = Math.max(0, f.health - damageTaken[i]);
    if (stunApplied[i]) f.stun = F.stunTicks;
  }

  // --- 4. Outcome ------------------------------------------------------
  let status: FightStatus = "fighting";
  const down0 = next[0].health <= 0;
  const down1 = next[1].health <= 0;
  if (down0 && down1) status = "draw";
  else if (down1) status = "player1";
  else if (down0) status = "player2";
  else if (tick >= F.roundTicks) {
    // On time, the fighter with more health wins. Equal health is a draw —
    // punches landed is deliberately NOT the tiebreak, because the two players'
    // detectors may differ in sensitivity and that would make hardware a
    // scoring factor (open question 6).
    status =
      next[0].health === next[1].health
        ? "draw"
        : next[0].health > next[1].health
          ? "player1"
          : "player2";
    events.push({ kind: "timeUp", winner: status });
  }

  if (status === "player1" || status === "player2") {
    if (tick < F.roundTicks) {
      events.push({ kind: "ko", winner: status === "player1" ? 0 : 1 });
    }
  }

  return {
    tick,
    fighters: [next[0], next[1]] as const,
    status,
    events,
  };
}

/** Seconds remaining in the round, for display only. */
export function timeRemaining(state: FightState): number {
  return Math.max(0, (F.roundTicks - state.tick) / F.tickRate);
}
