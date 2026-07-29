import type { FighterInput } from "./fightSim";
import type { HeadState } from "../perception/dodgeDetector";
import type { PunchType, HandSide } from "../perception/punchTypes";

// Camera-driven input: the perception layer's output, shaped into the same
// FighterInput a keyboard produces.
//
// This module is the whole seam between perception and simulation. It is
// deliberately tiny, and that is the point — 01-ARCHITECTURE.md keeps the two
// layers apart precisely so that swapping a keyboard for a camera is a change
// of input source and nothing else. The fight has no idea which it is being
// driven by, and the same simulation that was tested against synthetic
// keyboard input runs unchanged here.

/** A punch the detector reported, waiting to be handed to the next tick. */
export interface QueuedPunch {
  type: PunchType;
  hand: HandSide;
}

/**
 * Head state arrives as continuous lean/duck already in the -1..1 and 0..1
 * ranges the simulation wants, so no rescaling happens here. That is not luck:
 * 03-GESTURE-CLASSIFICATION.md specified continuous head state rather than
 * discrete "dodged" events exactly so the fight could read it at the moment a
 * punch resolves.
 *
 * On losing tracking the detector holds its last state rather than snapping to
 * neutral, so a player mid-slip is not straightened up by a dropped frame — and
 * this function must not undo that by substituting a neutral value.
 */
export function cameraInput(
  queuedPunch: QueuedPunch | null,
  head: HeadState | null
): FighterInput {
  return {
    punch: queuedPunch,
    // NEGATED, and this is load-bearing. HeadState.lean is in IMAGE space: the
    // camera sees you unmirrored, so leaning to your own right moves your head
    // toward image-left and reports a negative value. The simulation's lean is
    // in the fighter's OWN frame, where +1 means their right. Getting this
    // backwards would make every slip dodge the wrong way — and it would look
    // correct on screen, because the camera preview is mirrored.
    lean: -(head?.lean ?? 0),
    duck: head?.duck ?? 0,
  };
}
