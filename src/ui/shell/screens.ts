/**
 * Top-level views. Kept as a flat union rather than a router library: there are
 * five screens, no URLs to deep-link to, and the camera stage must survive
 * screen changes without remounting.
 */
export type Screen = "menu" | "train" | "fight" | "howto" | "settings";

export const SCREEN_TITLES: Record<Screen, string> = {
  menu: "Throwdown",
  train: "Training",
  fight: "Fight",
  howto: "How to play",
  settings: "Settings",
};
