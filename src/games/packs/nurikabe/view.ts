import type { Ids } from "../../core/commands";
import { focusLegend, sample, sampleCell, type BoardPrefs } from "../../lib/grid-kit/view";
import { shadeView, type ShadeIds } from "../../lib/shade-kit/view";
import { nurikabe, type NurikabeConflicts, type NurikabePuzzle } from "./logic";

/** Derived: NurikabeConflicts to flag on the board. */
export const CONFLICTS_KEY = "nurikabe.conflicts";

declare module "../../core/commands" {
  interface CommandNames extends Ids<Record<ShadeIds<"nurikabe">, true>> {}
}

const legend = (): { sample: string; meaning: string }[] => [
  { sample: sample(sampleCell() + `<text x="5" y="5.3" text-anchor="middle" dominant-baseline="central" font-size="5.6" fill="var(--text)" style="font-family: var(--font); font-weight: 600">3</text>`), meaning: "a number: the size of the island it sits in" },
  { sample: sample(sampleCell() + `<rect width="10" height="10" fill="var(--text)"/>`), meaning: "a shaded cell: sea" },
  { sample: sample(sampleCell() + `<circle cx="5" cy="5" r="1" fill="var(--text-dim)"/>`), meaning: "a dot: your note that a cell is island" },
  { sample: sample(sampleCell() + `<rect width="10" height="10" fill="var(--danger)"/>`), meaning: "sea breaking a rule: a 2×2 block of sea, or sea cut off from the rest" },
  { sample: sample(sampleCell() + `<rect width="10" height="10" fill="var(--danger-soft)"/>`), meaning: "dotted cells in an island with two numbers, too many cells, or no number" },
  ...focusLegend("the cells it changes", "the cells or numbers it comes from", "the island it's about"),
];

export function nurikabeView(board: BoardPrefs) {
  return shadeView<NurikabePuzzle, "nurikabe">({
    puzzle: nurikabe,
    prefix: "nurikabe",
    shadeWord: "shade",
    glyph: "fill",
    fixed: (p, c) => p.nums[c]! > 0,
    text: (p, c) => (p.nums[c]! > 0 ? { text: String(p.nums[c]), corner: false } : null),
    flags: {
      key: CONFLICTS_KEY,
      read: (x) => {
        const k = x as NurikabeConflicts;
        return { marks: new Set([...k.pools, ...k.sea]), texts: new Set(k.clues), cells: new Set(k.islands) };
      },
    },
    legend: legend(),
  }, board);
}
