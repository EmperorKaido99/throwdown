import { FIGHT_CONFIG as F } from "../config/tuning";
import type { HandSide, PunchType } from "../perception/punchTypes";

// Milestone 3 — the fight itself.
//
// This module is a PURE FUNCTION of (state, input) -> state. No wall clock, no
// I/O, no reads of the perception layer, and no Math.random — the only source
// of chance is a seed carried inside the state. That is not tidiness: rollback
// netcode (Milestone 6) works by re-running past ticks with corrected input,
// which is only sound if replaying the same ticks with the same inputs gives
// the same result. Every shortcut here costs that property.
//
// It is also deliberately punch-set agnostic. Damage is keyed by punch type,
// but nothing requires all four types to exist. If detection ends up able to
// report only "a punch happened", pass the same type every time and the fight
// still works — see 02-IMPLEMENTATION-PLAN.md's descope options.

export type PlayerIndex = 0 | 1;

/** What one fighter is doing on one tick. This is what crosses the network. */
export interface FighterInput {
  punch: { type: PunchType; hand: HandSide } | null;
  /** Head lean, -1 (their left) .. +1 (their right). */
  lean: number;
  /** Head duck, 0 (upright) .. 1 (fully ducked). */
  duck: number;
}

export type FightInput = readonly [FighterInput, FighterInput];

export interface PendingPunch {
  type: PunchType;
  hand: HandSide;
  /** Tick at which this resolves against the defender's head state. */
  resolvesAt: number;
}

export interface FighterState {
  health: number;
  /** Falls permanently with each knockdown taken. */
  maxHealth: number;
  recovery: number;
  stun: number;
  /** Ticks left on the referee's count. 0 when standing. */
  down: number;
  /** Knockdowns taken across the whole bout. */
  knockdowns: number;
  /** Knockdowns SCORED this round — how rounds are won. */
  roundScore: number;
  roundsWon: number;
  /** Ticks left of the counter window opened by a successful evade. */
  counter: number;
  pending: readonly PendingPunch[];
  thrown: number;
  landed: number;
  evaded: number;
}

export type FightStatus =
  | "fighting"
  | "count"
  | "roundBreak"
  | "player1"
  | "player2"
  | "draw";

export interface FightState {
  tick: number;
  /** 1-based. */
  round: number;
  /** Ticks elapsed within the current round or break. */
  roundTick: number;
  fighters: readonly [FighterState, FighterState];
  status: FightStatus;
  /** Deterministic chance. Part of the state so a replay reproduces it. */
  seed: number;
  events: readonly FightEvent[];
}

export type FightEvent =
  | { kind: "thrown"; by: PlayerIndex; type: PunchType; hand: HandSide }
  | { kind: "landed"; by: PlayerIndex; type: PunchType; hand: HandSide; damage: number; counter: boolean }
  | { kind: "evaded"; by: PlayerIndex; type: PunchType; how: "slip" | "duck" }
  | { kind: "counterOpen"; by: PlayerIndex }
  | { kind: "knockdown"; who: PlayerIndex }
  | { kind: "rose"; who: PlayerIndex; count: number }
  | { kind: "roundEnd"; round: number; winner: PlayerIndex | null }
  | { kind: "roundStart"; round: number }
  | { kind: "ko"; winner: PlayerIndex }
  | { kind: "decision"; winner: FightStatus };

export const NEUTRAL_INPUT: FighterInput = { punch: null, lean: 0, duck: 0 };

/** Linear congruential generator. Small, fast, and exactly reproducible. */
function nextSeed(seed: number): number {
  return (Math.imul(seed, 1664525) + 1013904223) >>> 0;
}
function toUnit(seed: number): number {
  return seed / 4294967296;
}

function freshFighter(): FighterState {
  return {
    health: F.startingHealth,
    maxHealth: F.startingHealth,
    recovery: 0,
    stun: 0,
    down: 0,
    knockdowns: 0,
    roundScore: 0,
    roundsWon: 0,
    counter: 0,
    pending: [],
    thrown: 0,
    landed: 0,
    evaded: 0,
  };
}

export function initialFight(seed = 0x9e3779b9): FightState {
  return {
    tick: 0,
    round: 1,
    roundTick: 0,
    fighters: [freshFighter(), freshFighter()],
    status: "fighting",
    seed: seed >>> 0,
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
function evasion(punch: PendingPunch, defender: FighterInput): "slip" | "duck" | null {
  // An uppercut comes up under the guard, so ducking feeds it. Everything else
  // is ducked under.
  if (punch.type !== "uppercut" && defender.duck >= F.duckUnder) return "duck";
  const straight = punch.type === "jab" || punch.type === "cross";
  if (straight && Math.abs(defender.lean) >= F.slipLean) return "slip";
  return null;
}

type Mutable = Omit<FighterState, "pending"> & { pending: PendingPunch[] };

function copyFighters(state: FightState): Mutable[] {
  return state.fighters.map((f) => ({ ...f, pending: [...f.pending] }));
}

function pack(
  state: FightState,
  next: Mutable[],
  patch: Partial<FightState>,
  events: FightEvent[]
): FightState {
  return {
    ...state,
    ...patch,
    fighters: [next[0], next[1]] as const,
    events,
  };
}

/** Advances the fight by exactly one tick. */
export function stepFight(state: FightState, input: FightInput): FightState {
  if (state.status === "player1" || state.status === "player2" || state.status === "draw") {
    return { ...state, events: [] };
  }

  const events: FightEvent[] = [];
  const next = copyFighters(state);
  const tick = state.tick + 1;
  let seed = state.seed;

  // ---- between rounds -------------------------------------------------
  if (state.status === "roundBreak") {
    const roundTick = state.roundTick + 1;
    if (roundTick < F.roundBreakTicks) {
      return pack(state, next, { tick, roundTick }, events);
    }
    // New round: both boxers recover to their (possibly reduced) maximum.
    for (const f of next) {
      f.health = f.maxHealth;
      f.recovery = 0;
      f.stun = 0;
      f.counter = 0;
      f.roundScore = 0;
      f.pending = [];
    }
    const round = state.round + 1;
    events.push({ kind: "roundStart", round });
    return pack(state, next, { tick, round, roundTick: 0, status: "fighting" }, events);
  }

  // ---- the referee's count --------------------------------------------
  if (state.status === "count") {
    const downIndex = next[0].down > 0 ? 0 : 1;
    const boxer = next[downIndex];
    boxer.down -= 1;
    if (boxer.down > 0) {
      return pack(state, next, { tick }, events);
    }

    // Count elapsed: can they rise? Harder every time they have been down.
    seed = nextSeed(seed);
    const chance =
      F.riseChance[Math.min(boxer.knockdowns - 1, F.riseChance.length - 1)] ?? 0;
    const rises = toUnit(seed) < chance;

    if (!rises) {
      const winner: PlayerIndex = downIndex === 0 ? 1 : 0;
      events.push({ kind: "ko", winner });
      return pack(
        state,
        next,
        { tick, seed, status: winner === 0 ? "player1" : "player2" },
        events
      );
    }

    // Up, but permanently diminished.
    boxer.maxHealth = Math.max(
      F.maxHealthLossPerKnockdown,
      boxer.maxHealth - F.maxHealthLossPerKnockdown
    );
    boxer.health = boxer.maxHealth;
    boxer.stun = F.stunTicks;
    events.push({ kind: "rose", who: downIndex, count: boxer.knockdowns });
    return pack(state, next, { tick, seed, status: "fighting" }, events);
  }

  // ---- live round ------------------------------------------------------
  const roundTick = state.roundTick + 1;

  // 1. Throws
  for (const i of [0, 1] as const) {
    const me = next[i];
    const cmd = input[i].punch;
    if (!cmd) continue;
    // Stun and recovery both suppress a throw. The perception layer keeps
    // reporting punches while a fighter is staggered; the fight decides
    // whether they count.
    if (me.recovery > 0 || me.stun > 0 || me.down > 0) continue;

    me.pending.push({ type: cmd.type, hand: cmd.hand, resolvesAt: tick + F.windupTicks });
    me.recovery = F.recoveryTicks;
    me.thrown += 1;
    events.push({ kind: "thrown", by: i, type: cmd.type, hand: cmd.hand });
  }

  // 2. Resolutions. Damage is accumulated and applied after both sides
  //    resolve, so a double knockdown is a draw rather than a win for whoever
  //    happens to be checked first.
  const damageTaken: [number, number] = [0, 0];
  const stunApplied: [boolean, boolean] = [false, false];
  const consumedCounter: [boolean, boolean] = [false, false];

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
        // Slipping opens the defender's counter window. This is the loop the
        // whole fight is built around: defence creates offence.
        defender.counter = F.counterWindowTicks;
        events.push({ kind: "evaded", by: i, type: p.type, how: dodged });
        events.push({ kind: "counterOpen", by: defenderIndex });
        continue;
      }

      const ducking = defenderInput.duck >= F.duckUnder;
      const isCounter = attacker.counter > 0;
      let dmg = F.damage[p.type] ?? F.damage.jab;
      if (p.type === "uppercut" && ducking) dmg *= F.uppercutDuckPenalty;
      if (defender.stun > 0) dmg *= F.stunnedDamageMultiplier;
      if (isCounter) {
        dmg *= F.counterDamageMultiplier;
        consumedCounter[i] = true;
      }
      dmg = Math.round(dmg);

      damageTaken[defenderIndex] += dmg;
      stunApplied[defenderIndex] = true;
      attacker.landed += 1;
      events.push({
        kind: "landed",
        by: i,
        type: p.type,
        hand: p.hand,
        damage: dmg,
        counter: isCounter,
      });
    }
    attacker.pending = stillPending;
  }

  // 3. Timers and damage
  for (const i of [0, 1] as const) {
    const f = next[i];
    f.recovery = Math.max(0, f.recovery - 1);
    f.stun = Math.max(0, f.stun - 1);
    // A counter window spent on a punch closes; otherwise it ticks away.
    f.counter = consumedCounter[i] ? 0 : Math.max(0, f.counter - 1);
    if (damageTaken[i] > 0) f.health = Math.max(0, f.health - damageTaken[i]);
    if (stunApplied[i]) f.stun = F.stunTicks;
  }

  // 4. Knockdowns
  const down0 = next[0].health <= 0;
  const down1 = next[1].health <= 0;
  if (down0 || down1) {
    // Both down at once is a draw — neither can be counted out first.
    if (down0 && down1) {
      events.push({ kind: "knockdown", who: 0 });
      events.push({ kind: "knockdown", who: 1 });
      return pack(state, next, { tick, roundTick, status: "draw" }, events);
    }
    const whoIndex: PlayerIndex = down0 ? 0 : 1;
    const scorer: PlayerIndex = down0 ? 1 : 0;
    const boxer = next[whoIndex];
    boxer.down = F.countTicks;
    boxer.knockdowns += 1;
    boxer.pending = [];
    next[scorer].roundScore += 1;
    next[scorer].pending = [];
    events.push({ kind: "knockdown", who: whoIndex });
    return pack(state, next, { tick, roundTick, status: "count" }, events);
  }

  // 5. End of round
  if (roundTick >= F.roundTicks) {
    const a = next[0].roundScore;
    const b = next[1].roundScore;
    const winner: PlayerIndex | null = a === b ? null : a > b ? 0 : 1;
    if (winner !== null) next[winner].roundsWon += 1;
    events.push({ kind: "roundEnd", round: state.round, winner });

    if (state.round >= F.rounds) {
      // Decision. Rounds first, then knockdowns, then stamina left. Punches
      // landed is deliberately NOT a tiebreak: the two players' detectors may
      // differ in sensitivity, and scoring on punch count would make hardware
      // a scoring factor (open question 6).
      const status = decide(next);
      events.push({ kind: "decision", winner: status });
      return pack(state, next, { tick, roundTick, status }, events);
    }
    return pack(state, next, { tick, roundTick: 0, status: "roundBreak" }, events);
  }

  return pack(state, next, { tick, roundTick }, events);
}

function decide(f: Mutable[]): FightStatus {
  if (f[0].roundsWon !== f[1].roundsWon) {
    return f[0].roundsWon > f[1].roundsWon ? "player1" : "player2";
  }
  if (f[0].knockdowns !== f[1].knockdowns) {
    // Fewer knockdowns TAKEN is better.
    return f[0].knockdowns < f[1].knockdowns ? "player1" : "player2";
  }
  if (f[0].health !== f[1].health) {
    return f[0].health > f[1].health ? "player1" : "player2";
  }
  return "draw";
}

/** Seconds remaining in the current round, for display only. */
export function timeRemaining(state: FightState): number {
  if (state.status === "roundBreak") {
    return Math.max(0, (F.roundBreakTicks - state.roundTick) / F.tickRate);
  }
  return Math.max(0, (F.roundTicks - state.roundTick) / F.tickRate);
}

/** Seconds left on the referee's count, or null when nobody is down. */
export function countRemaining(state: FightState): number | null {
  if (state.status !== "count") return null;
  const down = Math.max(state.fighters[0].down, state.fighters[1].down);
  return Math.ceil(down / F.tickRate);
}

export function isOver(state: FightState): boolean {
  return (
    state.status === "player1" ||
    state.status === "player2" ||
    state.status === "draw"
  );
}
