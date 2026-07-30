import { describe, expect, it } from "vitest";
import { cameraInput } from "./cameraInput";
import { initialFight, stepFight, NEUTRAL_INPUT, type FightInput } from "./fightSim";
import { FIGHT_CONFIG as F } from "../config/tuning";
import type { HeadState } from "../perception/dodgeDetector";

// The camera seam, tested without a camera.
//
// A fake webcam gives a synthetic pattern with no body in it, so nothing
// downstream of MediaPipe can be exercised in CI. What CAN be pinned down is
// the mapping itself: given a punch event and a head state, does the fight
// receive the right input? Every bug this catches is one that would otherwise
// only surface as the game feeling wrong, with no way to tell which layer.

const head = (lean: number, duck = 0): HeadState => ({
  tracked: true,
  lean,
  duck,
  raw: { lateral: lean * 0.3, headDrop: 0, bodyDrop: 0 },
});

describe("camera input mapping", () => {
  it("passes a detected punch straight through", () => {
    const input = cameraInput({ type: "cross", hand: "right" }, head(0));
    expect(input.punch).toEqual({ type: "cross", hand: "right" });
  });

  it("reports no punch when the detector reported none", () => {
    expect(cameraInput(null, head(0)).punch).toBeNull();
  });

  it("flips image-space lean into the fighter's own frame", () => {
    // Leaning to your OWN right moves your head toward image-left, which the
    // detector reports as negative. The fight wants +1 for "their right".
    expect(cameraInput(null, head(-1)).lean).toBe(1);
    expect(cameraInput(null, head(1)).lean).toBe(-1);
  });

  it("passes duck through unchanged — it has no handedness", () => {
    expect(cameraInput(null, head(0, 0.8)).duck).toBeCloseTo(0.8);
  });

  it("survives head state being unavailable", () => {
    const input = cameraInput(null, null);
    expect(input.lean).toBe(0);
    expect(input.duck).toBe(0);
  });
});

describe("camera input drives the fight", () => {
  const run = (s: ReturnType<typeof initialFight>, n: number, at: () => FightInput) => {
    let cur = s;
    for (let i = 0; i < n; i++) cur = stepFight(cur, at());
    return cur;
  };

  it("a camera-detected punch lands damage", () => {
    let s = stepFight(initialFight(), [
      cameraInput({ type: "cross", hand: "right" }, head(0)),
      NEUTRAL_INPUT,
    ]);
    s = run(s, F.windupTicks, () => [cameraInput(null, head(0)), NEUTRAL_INPUT]);
    expect(s.fighters[1].health).toBe(F.startingHealth - F.damage.cross);
  });

  it("leaning your head slips an incoming straight punch", () => {
    // The bot throws; the player leans hard enough to clear the slip threshold.
    let s = stepFight(initialFight(), [
      cameraInput(null, head(0)),
      { punch: { type: "jab", hand: "left" }, lean: 0, duck: 0 },
    ]);
    s = run(s, F.windupTicks, () => [cameraInput(null, head(-1)), NEUTRAL_INPUT]);
    expect(s.fighters[0].health).toBe(F.startingHealth);
    // And slipping must open the counter window, or head movement is pointless.
    expect(s.fighters[0].counter).toBeGreaterThan(0);
  });

  it("ducking clears a hook", () => {
    let s = stepFight(initialFight(), [
      cameraInput(null, head(0)),
      { punch: { type: "hook", hand: "left" }, lean: 0, duck: 0 },
    ]);
    s = run(s, F.windupTicks, () => [cameraInput(null, head(0, 1)), NEUTRAL_INPUT]);
    expect(s.fighters[0].health).toBe(F.startingHealth);
  });

  it("a lean too shallow to be a slip does not save you", () => {
    let s = stepFight(initialFight(), [
      cameraInput(null, head(0)),
      { punch: { type: "jab", hand: "left" }, lean: 0, duck: 0 },
    ]);
    const shallow = -(F.slipLean - 0.05);
    s = run(s, F.windupTicks, () => [cameraInput(null, head(shallow)), NEUTRAL_INPUT]);
    expect(s.fighters[0].health).toBeLessThan(F.startingHealth);
  });
});
