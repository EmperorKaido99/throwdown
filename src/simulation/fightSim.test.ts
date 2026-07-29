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
  it("knocks a fighter down rather than ending the fight outright", () => {
    let s = initialFight();
    for (let i = 0; i < 20000 && s.status === "fighting"; i++) {
      s = stepFight(s, pair(punch("uppercut"), NEUTRAL_INPUT));
    }
    // Stamina gone means DOWN, not out — the count decides.
    expect(s.status).toBe("count");
    expect(s.fighters[1].down).toBeGreaterThan(0);
    expect(s.fighters[1].knockdowns).toBe(1);
    expect(s.fighters[0].roundScore).toBe(1);
  });

  it("runs a count, and a fighter who rises comes back diminished", () => {
    let s = initialFight();
    while (s.status === "fighting") s = stepFight(s, pair(punch("uppercut"), NEUTRAL_INPUT));
    expect(s.status).toBe("count");

    const before = s.fighters[1].maxHealth;
    s = run(s, F.countTicks + 1, () => idle);
    // Either counted out, or up with a permanently lower ceiling.
    if (s.status === "fighting") {
      expect(s.fighters[1].maxHealth).toBeLessThan(before);
      expect(s.fighters[1].health).toBe(s.fighters[1].maxHealth);
    } else {
      expect(s.status).toBe("player1");
    }
  });

  it("scores the round on knockdowns and moves to the next round", () => {
    let s = run(initialFight(), F.roundTicks);
    expect(s.status).toBe("roundBreak");
    expect(s.round).toBe(1);

    s = run(s, F.roundBreakTicks + 1);
    expect(s.status).toBe("fighting");
    expect(s.round).toBe(2);
    // Both boxers come out restored for the new round.
    expect(s.fighters[0].health).toBe(s.fighters[0].maxHealth);
  });

  it("goes to a decision after the final round", () => {
    let s = initialFight();
    let guard = 0;
    while (!["player1", "player2", "draw"].includes(s.status) && guard++ < 200000) {
      s = stepFight(s, idle);
    }
    // Nobody threw anything, so it is a draw on every tiebreak.
    expect(s.status).toBe("draw");
  });

  it("calls a double knockdown a draw rather than favouring player 1", () => {
    let s = initialFight();
    let guard = 0;
    while (s.status === "fighting" && guard++ < 20000) {
      s = stepFight(s, pair(punch("uppercut"), punch("uppercut")));
    }
    expect(s.status).toBe("draw");
  });
});


describe("fight simulation — the counter window", () => {
  it("opens a counter window for the fighter who slipped", () => {
    let s = stepFight(initialFight(), pair(punch("jab"), NEUTRAL_INPUT));
    s = run(s, F.windupTicks, () => pair(NEUTRAL_INPUT, slip()));
    expect(s.fighters[1].counter).toBeGreaterThan(0);
    expect(s.events.some((e) => e.kind === "counterOpen")).toBe(true);
  });

  it("makes a counter-punch hit far harder than the same punch cold", () => {
    // Cold jab.
    let cold = stepFight(initialFight(), pair(NEUTRAL_INPUT, punch("jab")));
    cold = run(cold, F.windupTicks);
    const coldDamage = F.startingHealth - cold.fighters[0].health;

    // Player 2 slips a jab, then throws their own into the open window.
    let hot = stepFight(initialFight(), pair(punch("jab"), NEUTRAL_INPUT));
    hot = run(hot, F.windupTicks, () => pair(NEUTRAL_INPUT, slip()));
    hot = stepFight(hot, pair(NEUTRAL_INPUT, punch("jab")));
    hot = run(hot, F.windupTicks);
    const hotDamage = F.startingHealth - hot.fighters[0].health;

    expect(hotDamage).toBeGreaterThan(coldDamage);
  });

  it("closes the window once it has been spent", () => {
    let s = stepFight(initialFight(), pair(punch("jab"), NEUTRAL_INPUT));
    s = run(s, F.windupTicks, () => pair(NEUTRAL_INPUT, slip()));
    s = stepFight(s, pair(NEUTRAL_INPUT, punch("jab")));
    s = run(s, F.windupTicks);
    expect(s.fighters[1].counter).toBe(0);
  });

  it("lets the window expire if it is not used", () => {
    let s = stepFight(initialFight(), pair(punch("jab"), NEUTRAL_INPUT));
    s = run(s, F.windupTicks, () => pair(NEUTRAL_INPUT, slip()));
    s = run(s, F.counterWindowTicks + 2);
    expect(s.fighters[1].counter).toBe(0);
  });
});

describe("fight simulation — determinism with chance", () => {
  it("reproduces the same knockdown outcome from the same seed", () => {
    const play = () => {
      let s = initialFight(12345);
      let guard = 0;
      while (!["player1", "player2", "draw"].includes(s.status) && guard++ < 100000) {
        s = stepFight(s, pair(punch("uppercut"), NEUTRAL_INPUT));
      }
      return s;
    };
    expect(play()).toEqual(play());
  });

  it("can produce a different bout from a different seed", () => {
    const play = (seed: number) => {
      let s = initialFight(seed);
      let guard = 0;
      while (!["player1", "player2", "draw"].includes(s.status) && guard++ < 100000) {
        s = stepFight(s, pair(punch("uppercut"), NEUTRAL_INPUT));
      }
      return s.tick;
    };
    // Not a strict requirement of correctness, but if every seed gave an
    // identical bout the seed would be doing nothing.
    const ticks = new Set([play(1), play(2), play(3), play(4), play(5)]);
    expect(ticks.size).toBeGreaterThan(1);
  });
});
