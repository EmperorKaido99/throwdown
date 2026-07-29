import { describe, expect, it } from "vitest";
import {
  NEUTRAL_INPUT,
  initialFight,
  stepFight,
  type FighterInput,
  type FightInput,
  type FightState,
} from "./fightSim";
import { FIGHT_CONFIG as F } from "../config/tuning";
import type { PunchType } from "../perception/punchTypes";

const punch = (type: PunchType): FighterInput => ({
  punch: { type, hand: "left" },
  lean: 0,
  duck: 0,
});
const slip = (): FighterInput => ({ punch: null, lean: 1, duck: 0 });
const duck = (): FighterInput => ({ punch: null, lean: 0, duck: 1 });

const pair = (a: FighterInput, b: FighterInput): FightInput => [a, b];
const idle = pair(NEUTRAL_INPUT, NEUTRAL_INPUT);

/** Runs `n` ticks, optionally overriding the input on specific ticks. */
function run(
  state: FightState,
  n: number,
  inputAt: (tick: number) => FightInput = () => idle
): FightState {
  let s = state;
  for (let i = 0; i < n; i++) s = stepFight(s, inputAt(s.tick));
  return s;
}

describe("fight simulation — purity", () => {
  // Rollback netcode re-runs past ticks with corrected input. That is only
  // sound if the same (state, input) always gives the same result, and if
  // stepping never mutates the state it was handed.
  it("is deterministic: same state and input give the same result", () => {
    const start = initialFight();
    const a = run(start, 200, (t) => (t === 5 ? pair(punch("cross"), idle[1]) : idle));
    const b = run(start, 200, (t) => (t === 5 ? pair(punch("cross"), idle[1]) : idle));
    expect(a).toEqual(b);
  });

  it("does not mutate the state it is given", () => {
    const start = initialFight();
    const snapshot = JSON.parse(JSON.stringify(start));
    stepFight(start, pair(punch("jab"), punch("hook")));
    expect(start).toEqual(snapshot);
  });

  it("never reads wall time — replaying from a mid-fight state matches", () => {
    const start = initialFight();
    const mid = run(start, 50, (t) => (t % 30 === 0 ? pair(punch("jab"), idle[1]) : idle));
    const fromMidA = run(mid, 100);
    const fromMidB = run(mid, 100);
    expect(fromMidA).toEqual(fromMidB);
  });
});

describe("fight simulation — punches", () => {
  it("does not resolve a punch until its wind-up has elapsed", () => {
    let s = stepFight(initialFight(), pair(punch("jab"), NEUTRAL_INPUT));
    expect(s.fighters[0].pending).toHaveLength(1);

    s = run(s, F.windupTicks - 1);
    expect(s.fighters[1].health).toBe(F.startingHealth);

    s = stepFight(s, idle);
    expect(s.fighters[1].health).toBeLessThan(F.startingHealth);
  });

  it("applies the punch type's damage", () => {
    let s = stepFight(initialFight(), pair(punch("cross"), NEUTRAL_INPUT));
    s = run(s, F.windupTicks);
    expect(s.fighters[1].health).toBe(F.startingHealth - F.damage.cross);
  });

  it("refuses a second punch during recovery", () => {
    let s = stepFight(initialFight(), pair(punch("jab"), NEUTRAL_INPUT));
    s = stepFight(s, pair(punch("jab"), NEUTRAL_INPUT));
    expect(s.fighters[0].thrown).toBe(1);
  });

  it("works with a single punch type, for the descoped punch set", () => {
    // If detection can only report "a punch happened", the fight is unaffected.
    let s = initialFight();
    s = stepFight(s, pair(punch("jab"), NEUTRAL_INPUT));
    s = run(s, F.windupTicks);
    expect(s.fighters[1].health).toBeLessThan(F.startingHealth);
  });
});

describe("fight simulation — defence", () => {
  it("slips a straight punch with a lateral lean", () => {
    let s = stepFight(initialFight(), pair(punch("jab"), NEUTRAL_INPUT));
    // The lean starts AFTER the punch was thrown and still beats it — defence
    // is read at the resolving tick, not the throwing tick.
    s = run(s, F.windupTicks, () => pair(NEUTRAL_INPUT, slip()));
    expect(s.fighters[1].health).toBe(F.startingHealth);
    expect(s.fighters[0].evaded).toBe(1);
  });

  it("does not slip a hook — a hook comes around the lean", () => {
    let s = stepFight(initialFight(), pair(punch("hook"), NEUTRAL_INPUT));
    s = run(s, F.windupTicks, () => pair(NEUTRAL_INPUT, slip()));
    expect(s.fighters[1].health).toBeLessThan(F.startingHealth);
  });

  it("ducks under a hook", () => {
    let s = stepFight(initialFight(), pair(punch("hook"), NEUTRAL_INPUT));
    s = run(s, F.windupTicks, () => pair(NEUTRAL_INPUT, duck()));
    expect(s.fighters[1].health).toBe(F.startingHealth);
  });

  it("punishes ducking into an uppercut", () => {
    let ducked = stepFight(initialFight(), pair(punch("uppercut"), NEUTRAL_INPUT));
    ducked = run(ducked, F.windupTicks, () => pair(NEUTRAL_INPUT, duck()));

    let upright = stepFight(initialFight(), pair(punch("uppercut"), NEUTRAL_INPUT));
    upright = run(upright, F.windupTicks);

    expect(ducked.fighters[1].health).toBeLessThan(upright.fighters[1].health);
  });

  it("ignores a lean below the slip threshold", () => {
    const shallow: FighterInput = { punch: null, lean: F.slipLean - 0.01, duck: 0 };
    let s = stepFight(initialFight(), pair(punch("jab"), NEUTRAL_INPUT));
    s = run(s, F.windupTicks, () => pair(NEUTRAL_INPUT, shallow));
    expect(s.fighters[1].health).toBeLessThan(F.startingHealth);
  });
});

describe("fight simulation — outcome", () => {
  it("ends on a knockout and then stops advancing", () => {
    let s = initialFight();
    // Throw until someone drops. Recovery paces this automatically.
    for (let i = 0; i < 20000 && s.status === "fighting"; i++) {
      s = stepFight(s, pair(punch("uppercut"), NEUTRAL_INPUT));
    }
    expect(s.status).toBe("player1");
    expect(s.fighters[1].health).toBe(0);

    const after = stepFight(s, pair(punch("jab"), NEUTRAL_INPUT));
    expect(after.tick).toBe(s.tick);
    expect(after.status).toBe("player1");
  });

  it("awards a time-up win on health, and draws when health is equal", () => {
    const drawn = run(initialFight(), F.roundTicks);
    expect(drawn.status).toBe("draw");

    let s = stepFight(initialFight(), pair(punch("jab"), NEUTRAL_INPUT));
    s = run(s, F.roundTicks);
    expect(s.status).toBe("player1");
  });

  it("calls a double knockout a draw rather than favouring player 1", () => {
    // Both land on the same tick with lethal accumulated damage.
    let s = initialFight();
    let guard = 0;
    while (s.status === "fighting" && guard++ < 20000) {
      s = stepFight(s, pair(punch("uppercut"), punch("uppercut")));
    }
    expect(s.status).toBe("draw");
  });
});
