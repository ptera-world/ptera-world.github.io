import type { Ids } from "../../core/commands";
import { focusLegend, sample, sampleCell, type BoardPrefs } from "../../lib/grid-kit/view";
import { shadeView, type ShadeIds } from "../../lib/shade-kit/view";
import { norinori, type NorinoriConflicts, type NorinoriPuzzle } from "./logic";

/** Derived: NorinoriConflicts to flag on the board. */
export const CONFLICTS_KEY = "norinori.conflicts";

declare module "../../core/commands" {
  interface CommandNames extends Ids<Record<ShadeIds<"norinori">, true>> {}
}

const legend = (): { sample: string; meaning: string }[] => [
  { sample: sample(sampleCell() + `<rect width="10" height="10" fill="var(--text)"/>`), meaning: "a shaded cell" },
  { sample: sample(sampleCell() + `<circle cx="5" cy="5" r="1" fill="var(--text-dim)"/>`), meaning: "a dot: your note that a cell stays unshaded" },
  { sample: sample(sampleCell() + `<rect width="10" height="10" fill="var(--danger)"/>`), meaning: "shaded cells breaking a rule: a region with more than two, or three or more touching" },
  { sample: sample(sampleCell() + `<line x1="10" y1="0" x2="10" y2="10" stroke="var(--text)" stroke-width="0.9"/>`), meaning: "a region border" },
  ...focusLegend("the cells it changes", "the cells it comes from", "the region it's about"),
];

export function norinoriView(board: BoardPrefs) {
  return shadeView<NorinoriPuzzle, "norinori">({
    puzzle: norinori,
    prefix: "norinori",
    shadeWord: "shade",
    glyph: "fill",
    fixed: () => false,
    regions: (p) => p.regions,
    flags: {
      key: CONFLICTS_KEY,
      read: (c) => {
        const k = c as NorinoriConflicts | undefined;
        return { marks: new Set([...(k?.regions ?? []), ...(k?.clumps ?? [])]), texts: new Set(), cells: new Set() };
      },
    },
    legend: legend(),
  }, board);
}
