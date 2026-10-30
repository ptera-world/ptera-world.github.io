import type { Metric } from "../../core/types";
import { ctxOf, firstRight, solvedAt, type DataSource, type PokedlePuzzle, type PokedleState } from "./logic";

/**
 * Per attribute: on which guess it was first marked right, averaged over the boards of this game
 * that were found. Kept with the game's result, so the stats tab averages it per setup (a
 * 16-board game and a 1-board one never share a number).
 */
export function pokedleMetrics(data: DataSource) {
  return (p: PokedlePuzzle, s: PokedleState): Metric[] => {
    const attrs = ctxOf(data, p).data.attributes;
    const sums = new Map<string, { sum: number; n: number }>();
    p.boards.forEach((_, b) => {
      if (solvedAt(p, s, b) < 0) return;
      firstRight(data, p, s, b).forEach((k, i) => {
        if (k < 0) return;
        const id = p.attrs[i]!;
        const e = sums.get(id) ?? { sum: 0, n: 0 };
        sums.set(id, { sum: e.sum + k + 1, n: e.n + 1 });
      });
    });
    return [...sums].map(([id, v]) => ({
      id: `first-right:${id}`,
      label: `${attrs.find((a) => a.id === id)?.label ?? id} right by guess`,
      value: v.sum / v.n,
      better: "lower" as const,
    }));
  };
}
