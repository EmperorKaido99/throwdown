import { PUNCH_FAMILY, type HandSide, type PunchType, type Stance } from "./punchTypes";

// What the guided protocol says out loud.
//
// Kept out of the harness component because the wording is a measurement
// concern, not presentation. The confusion matrix scores the punch the player
// was ASKED for against the punch that was detected — so if the player has to
// remember that "jab" implies the lead hand, and which of their hands leads in
// their stance, a lapse is recorded as a classifier error. Naming the hand out
// loud removes an entire class of false negatives that has nothing to do with
// the perception layer.

/** Which physical hand the protocol wants for this punch, given the stance. */
export function handFor(type: PunchType, stance: Stance): HandSide {
  const lead = type === "jab" || type === "hook";
  const orthodox = stance === "orthodox";
  // Orthodox leads with the left; southpaw with the right.
  return lead === orthodox ? "left" : "right";
}

/** Per-rep cue. Must comfortably fit the ready window — keep it short. */
export function repCue(type: PunchType, stance: Stance): string {
  return `${type}, ${handFor(type, stance)} hand`;
}

const FORM_CUE: Record<PunchType, string> = {
  jab: "Quick and straight at the camera, then snap it back to guard.",
  cross: "Straight from the back hand. Turn your hip into it.",
  hook: "Swing it across in front of your face, elbow up.",
  uppercut: "Dip it down first, then drive up as if under the chin.",
};

/**
 * Spoken at the start of each block of one punch type. This is where the
 * length budget is, so the explaining happens here rather than between reps.
 */
export function blockIntro(
  type: PunchType,
  stance: Stance,
  reps: number,
  previous: PunchType | null
): string {
  const hand = handFor(type, stance);
  const switching = previous !== null && handFor(previous, stance) !== hand;
  const role = type === "jab" || type === "hook" ? "lead" : "rear";

  const parts: string[] = [];
  if (switching) parts.push("Switch hands.");
  parts.push(`Next up, ${reps} ${type}${reps === 1 ? "" : "s"}.`);
  parts.push(`${role === "lead" ? "Lead" : "Rear"} hand, your ${hand}.`);
  parts.push(FORM_CUE[type]);
  return parts.join(" ");
}

/** On-screen version of the block intro, for a player close enough to read. */
export function blockIntroLines(
  type: PunchType,
  stance: Stance,
  reps: number,
  previous: PunchType | null
): { heading: string; hand: string; cue: string; switching: boolean } {
  const hand = handFor(type, stance);
  return {
    heading: `${reps} × ${type.toUpperCase()}`,
    hand: `${type === "jab" || type === "hook" ? "lead" : "rear"} hand — your ${hand}`,
    cue: FORM_CUE[type],
    switching: previous !== null && handFor(previous, stance) !== hand,
  };
}

export const LEAD_IN_SPEECH =
  "Get into position. Stand back so your hips are in shot, hands up in guard. Starting in five seconds.";

/** Sanity check used by tests: family is what the fallback scope leans on. */
export function familyOf(type: PunchType) {
  return PUNCH_FAMILY[type];
}
