import type { Ids } from "../../core/commands";
import { focusLegend, sample, sampleCell, type BoardPrefs } from "../../lib/grid-kit/view";
import { shadeView, type ShadeIds } from "../../lib/shade-kit/view";
import { geometry, heyawake, type HeyawakeConflicts, type HeyawakePuzzle } from "./logic";

/** Derived: HeyawakeConflicts to flag on the board. */
export const CONFLICTS_KEY = "heyawake.conflicts";

declare module "../../core/commands" {
  interface CommandNames extends Ids<Record<ShadeIds<"heyawake">, true>> {}
}

const legend = (): { sample: string; meaning: string }[] => [
  { sample: sample(sampleCell() + `<text x="0.8" y="0.7" font-size="3.4" dominant-baseline="hanging" fill="var(--text)" style="font-family: var(--font); font-weight: 600">2</text>`), meaning: "a room's number: how many of its cells are shaded" },
  { sample: sample(sampleCell() + `<rect width="10" height="10" fill="var(--text)"/>`), meaning: "a shaded cell" },
  { sample: sample(sampleCell() + `<circle cx="5" cy="5" r="1" fill="var(--text-dim)"/>`), meaning: "a dot: your note that a cell stays unshaded" },
  { sample: sample(sampleCell() + `<rect width="10" height="10" fill="var(--danger)"/>`), meaning: "shaded cells that touch side by side" },
  { sample: sample(sampleCell() + `<rect width="10" height="10" fill="var(--danger-soft)"/>`), meaning: "cells breaking a rule: a dotted run across two walls, or cells cut off from the other unshaded cells" },
  { sample: sample(sampleCell() + `<line x1="10" y1="0" x2="10" y2="10" stroke="var(--text)" stroke-width="0.9"/>`), meaning: "a room wall" },
  ...focusLegend("the cells it changes", "the cells or number it comes from", "the shaded cells it counts"),
];

export function heyawakeView(board: BoardPrefs) {
  return shadeView<HeyawakePuzzle, "heyawake">({
    puzzle: heyawake,
    prefix: "heyawake",
    shadeWord: "shade",
    glyph: "fill",
    fixed: () => false,
    regions: (p) => p.rooms,
    text: (p, c) => {
      const r = p.rooms[c]!;
      return geometry(p).clueCell[r] === c && p.clues[r]! >= 0 ? { text: String(p.clues[r]), corner: true } : null;
    },
    flags: {
      key: CONFLICTS_KEY,
      read: (x) => {
        const k = x as HeyawakeConflicts;
        return { marks: new Set(k.touching), texts: new Set(k.rooms), cells: new Set([...k.runs, ...k.cut]) };
      },
    },
    legend: legend(),
  }, board);
}
