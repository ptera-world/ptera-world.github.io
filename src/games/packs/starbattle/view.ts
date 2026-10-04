import type { Ids } from "../../core/commands";
import { focusLegend, sample, sampleCell, type BoardPrefs } from "../../lib/grid-kit/view";
import { shadeView, starPath, type ShadeIds } from "../../lib/shade-kit/view";
import { starbattle, type StarBattleConflicts, type StarBattlePuzzle } from "./logic";

/** Derived: StarBattleConflicts to flag on the board. */
export const CONFLICTS_KEY = "starbattle.conflicts";

declare module "../../core/commands" {
  interface CommandNames extends Ids<Record<ShadeIds<"starbattle">, true>> {}
}

const legend = (): { sample: string; meaning: string }[] => [
  { sample: sample(sampleCell() + `<path d="${starPath(0, 0)}" fill="var(--text)"/>`), meaning: "a star" },
  { sample: sample(sampleCell() + `<circle cx="5" cy="5" r="1" fill="var(--text-dim)"/>`), meaning: "a dot: your note that a cell has no star" },
  { sample: sample(sampleCell() + `<path d="${starPath(0, 0)}" fill="var(--danger)"/>`), meaning: "stars breaking a rule: touching, or too many in a row, column or region" },
  { sample: sample(sampleCell() + `<line x1="10" y1="0" x2="10" y2="10" stroke="var(--text)" stroke-width="0.9"/>`), meaning: "a region border" },
  ...focusLegend("the cells it changes", "the cells it comes from", "the row, column or region it's about"),
];

export function starbattleView(board: BoardPrefs) {
  return shadeView<StarBattlePuzzle, "starbattle">({
    puzzle: starbattle,
    prefix: "starbattle",
    shadeWord: "star",
    glyph: "star",
    fixed: () => false,
    regions: (p) => p.regions,
    flags: {
      key: CONFLICTS_KEY,
      read: (c) => {
        const k = c as StarBattleConflicts | undefined;
        return { marks: new Set([...(k?.crowded ?? []), ...(k?.touching ?? [])]), texts: new Set(), cells: new Set() };
      },
    },
    legend: legend(),
  }, board);
}
