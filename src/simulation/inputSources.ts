import type { FighterInput } from "./fightSim";
import type { PunchType } from "../perception/punchTypes";

// Where a fighter's input comes from. The simulation takes FighterInput and
// does not care which of these produced it — that is the whole point of
// 01-ARCHITECTURE.md keeping simulation separate from perception, and it is
// what lets the fight be built and played before the camera path is trusted.

/** Keys held right now, as produced by the keyboard listener. */
export type KeySet = ReadonlySet<string>;

export interface KeyBindings {
  leanLeft: string;
  leanRight: string;
  duck: string;
  punches: Record<string, PunchType>;
}

/**
 * Two players sharing one keyboard. Player 1 uses the left of the keyboard,
 * player 2 the right, so the two hands never collide.
 */
export const PLAYER1_KEYS: KeyBindings = {
  leanLeft: "a",
  leanRight: "d",
  duck: "s",
  punches: { q: "jab", w: "cross", e: "hook", r: "uppercut" },
};

export const PLAYER2_KEYS: KeyBindings = {
  leanLeft: "arrowleft",
  leanRight: "arrowright",
  duck: "arrowdown",
  punches: { u: "jab", i: "cross", o: "hook", p: "uppercut" },
};

/**
 * Builds one tick of input from held keys plus a punch queued by a keypress.
 *
 * Punches are edge-triggered rather than read from the held set: holding a key
 * should throw one punch, not one per tick. The queue is filled by keydown and
 * drained here, which is also how a camera-driven punch event will arrive.
 */
export function keyboardInput(
  keys: KeySet,
  bindings: KeyBindings,
  queuedPunch: PunchType | null
): FighterInput {
  const left = keys.has(bindings.leanLeft);
  const right = keys.has(bindings.leanRight);
  return {
    punch: queuedPunch
      ? // Lead hand for jab/hook, rear for cross/uppercut, matching the
        // perception layer's convention so a keyboard fighter and a camera
        // fighter produce the same shape of event.
        {
          type: queuedPunch,
          hand:
            queuedPunch === "jab" || queuedPunch === "hook" ? "left" : "right",
        }
      : null,
    // Both held cancels out, which is what a player expects and what stops a
    // stuck key pinning a permanent slip.
    lean: left === right ? 0 : left ? -1 : 1,
    duck: keys.has(bindings.duck) ? 1 : 0,
  };
}

const AI_PUNCHES: PunchType[] = ["jab", "jab", "cross", "hook", "uppercut"];

/**
 * A scripted opponent, so the fight can be played without a second person.
 *
 * Deterministic in `tick` — no Math.random anywhere. That is not fussiness: a
 * fight containing this opponent has to stay replayable, and the moment it
 * depends on a random source the determinism tests in fightSim.test.ts stop
 * meaning anything for a real match.
 */
export function scriptedInput(tick: number, aggression = 1): FighterInput {
  const period = Math.max(30, Math.round(110 / aggression));
  const throwsNow = tick % period === 0;
  const index = Math.floor(tick / period) % AI_PUNCHES.length;

  // Defends in bursts, on a different cycle from its punches so the two drift
  // against each other instead of being predictable together.
  const defendPhase = tick % 190;
  const duck = defendPhase >= 150 && defendPhase < 170 ? 1 : 0;
  const lean = defendPhase >= 70 && defendPhase < 95 ? 1 : 0;

  return {
    punch: throwsNow
      ? {
          type: AI_PUNCHES[index],
          hand:
            AI_PUNCHES[index] === "jab" || AI_PUNCHES[index] === "hook"
              ? "left"
              : "right",
        }
      : null,
    lean,
    duck,
  };
}
