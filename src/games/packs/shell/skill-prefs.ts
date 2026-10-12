import { namespace, prefs } from "../../core/storage";
import type { HoldKey } from "../../core/gestures";
import type { AimScope } from "../../core/techniques";
import type { Technique } from "../../core/types";

/** What makes a technique count as learned, for a palette that shows learned techniques only. */
export type LearnedBy = "practice" | "watched" | "cast" | "casts";

/** Per technique, overriding whether the palette shows it. */
export type PalettePin = "auto" | "always" | "never";

declare module "../../core/storage" {
  interface Prefs {
    /** Pointing with a technique picked shows what it would do before a click carries it out. */
    skillPreview: boolean;
    skillScope: AimScope;
    /** "learned": the palette shows only techniques that meet `skillLearnedBy` (or are pinned). */
    skillPalette: "all" | "learned";
    skillLearnedBy: LearnedBy[];
    /** Casts that count for the "casts" criterion. */
    skillLearnedCasts: number;
    /** Most techniques the palette shows before a "more" tile; 0 = no limit. */
    skillBarMax: number;
    /** Held while clicking: cast whatever technique applies where you click. */
    holdFits: HoldKey;
    /** Held while scrolling the wheel: step through the palette's techniques. */
    skillWheel: HoldKey;
    /** Held while clicking a cell a technique decided: pick that technique. */
    skillEyedrop: HoldKey;
    /** Palette tiles light up when their technique applies where you point. */
    skillGlow: boolean;
    /** The board menu lists the techniques that apply where it was opened. */
    skillHerePopup: boolean;
    /** Cells keep the color of the technique that decided them. */
    skillKept: boolean;
    /** While a technique is picked, a right click does the board's other action, or puts the technique down. */
    skillRightClick: "mark" | "drop";
    /** Picker shape; "auto" is a ring for up to eight entries, a grid past that. */
    skillPicker: "auto" | "ring" | "grid";
    /** Picking a technique never watched opens its demo. */
    skillWatchAuto: boolean;
    /** Holding a palette tile (touch) opens its demo. */
    skillWatchHold: boolean;
    /** Palette tiles carry a button that opens their demo. */
    skillWatchButton: boolean;
  }
}

export const skillPrefs = {
  preview: () => prefs.get("skillPreview", false),
  scope: () => prefs.get("skillScope", "one"),
  palette: () => prefs.get("skillPalette", "all"),
  learnedBy: () => prefs.get("skillLearnedBy", ["practice", "watched", "cast"]),
  learnedCasts: () => prefs.get("skillLearnedCasts", 5),
  barMax: () => prefs.get("skillBarMax", 0),
  holdFits: () => prefs.get("holdFits", "none"),
  wheel: () => prefs.get("skillWheel", "alt"),
  eyedrop: () => prefs.get("skillEyedrop", "ctrl"),
  glow: () => prefs.get("skillGlow", false),
  herePopup: () => prefs.get("skillHerePopup", false),
  kept: () => prefs.get("skillKept", true),
  rightClick: () => prefs.get("skillRightClick", "mark"),
  picker: () => prefs.get("skillPicker", "auto"),
  watchAuto: () => prefs.get("skillWatchAuto", true),
  watchHold: () => prefs.get("skillWatchHold", true),
  watchButton: () => prefs.get("skillWatchButton", false),
};

interface Progress {
  practiced?: boolean;
  watched?: boolean;
  casts?: number;
}

const progressStore = namespace("technique-progress");
const pinStore = namespace("technique-pin");

export const progressOf = (t: Technique): Progress => progressStore.get<Progress>(t.id, {});

export function noteProgress(t: Technique, change: (p: Progress) => Progress): void {
  progressStore.set(t.id, change(progressOf(t)));
}

export const pinOf = (t: Technique): PalettePin => pinStore.get<PalettePin>(t.id, "auto");

export function setPin(t: Technique, pin: PalettePin): void {
  if (pin === "auto") pinStore.remove(t.id);
  else pinStore.set(t.id, pin);
}

/** True if `t` meets any of the player's learned criteria. */
export function learned(t: Technique): boolean {
  const p = progressOf(t);
  const casts = p.casts ?? 0;
  return skillPrefs.learnedBy().some((by) =>
    by === "practice" ? !!p.practiced : by === "watched" ? !!p.watched : by === "cast" ? casts >= 1 : casts >= skillPrefs.learnedCasts());
}

/** Whether the palette shows `t`: its pin, else every technique or only learned ones per the setting. */
export function inPalette(t: Technique): boolean {
  const pin = pinOf(t);
  if (pin !== "auto") return pin === "always";
  return skillPrefs.palette() === "all" || learned(t);
}
