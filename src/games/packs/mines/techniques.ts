import type { Step, Technique } from "../../core/types";
import { cellName, mineCount, numbers, visibleKnowledge, type MinesAction, type MinesFocus, type MinesPuzzle, type MinesState } from "./logic";
import { MINE, UNKNOWN, deduceAt, deduceCount, deduceGlobal, deducePairs, neighbourTable, type Deduction } from "./solver";

type MinesTechnique = Technique<MinesPuzzle, MinesState, MinesAction>;

/**
 * What the board shows: opened numbers, plus flags as known mines. Flags that aren't on a mine
 * are ignored, so every deduction stays sound (an auto-applied step can never open a mine
 * because of a wrong flag).
 */
export function knowledge(p: MinesPuzzle, s: MinesState): Int8Array {
  const K = visibleKnowledge(p, s);
  for (let c = 0; c < K.length; c++) if (s.flags[c] && p.mines[c] && K[c] === UNKNOWN) K[c] = MINE;
  return K;
}

/** A deduction narrowed to what it would change on this board, or null if it changes nothing. */
function effective(s: MinesState, d: Deduction): Deduction | null {
  const safe = d.safe.filter((c) => !s.open[c] && !s.flags[c]);
  const mines = d.mines.filter((c) => !s.flags[c]);
  return safe.length || mines.length ? { ...d, safe, mines } : null;
}

function actionsOf(d: Deduction): MinesAction[] {
  const out: MinesAction[] = [];
  if (d.safe.length) out.push({ type: "open", cells: d.safe });
  if (d.mines.length) out.push({ type: "flag", cells: d.mines, on: true });
  return out;
}

const plural = (n: number, one: string, many: string) => (n === 1 ? one : many);

/** "these 3 cells are safe and this one is a mine", for any mix. */
function outcome(d: Deduction): string {
  const parts: string[] = [];
  if (d.safe.length) parts.push(d.safe.length === 1 ? "that cell is safe" : `those ${d.safe.length} cells are safe`);
  if (d.mines.length) parts.push(d.mines.length === 1 ? "that cell is a mine" : `those ${d.mines.length} cells are mines`);
  return parts.join(" and ");
}

const focusOf = (d: Deduction): MinesFocus => ({ cells: [...d.safe, ...d.mines], sources: d.sources });

/** Every single-number deduction of the given kind, in cell order, already narrowed. */
function singles(p: MinesPuzzle, s: MinesState, kind: "safe" | "mines"): Deduction[] {
  if (s.dead >= 0) return [];
  const K = knowledge(p, s);
  const nb = neighbourTable(p.w, p.h);
  const out: Deduction[] = [];
  for (let c = 0; c < K.length; c++) {
    const raw = deduceAt(K, nb, c);
    if (!raw) continue;
    const d = effective(s, kind === "safe" ? { ...raw, mines: [] } : { ...raw, safe: [] });
    if (d) out.push(d);
  }
  return out;
}

function countDeduction(p: MinesPuzzle, s: MinesState): Deduction | null {
  if (s.dead >= 0) return null;
  const raw = deduceCount(knowledge(p, s), mineCount(p));
  return raw && effective(s, raw);
}

function pairDeductions(p: MinesPuzzle, s: MinesState): Deduction[] {
  if (s.dead >= 0) return [];
  const K = knowledge(p, s);
  return deducePairs(K, p.w, p.h, neighbourTable(p.w, p.h)).flatMap((d) => effective(s, d) ?? []);
}

function regionDeduction(p: MinesPuzzle, s: MinesState): Deduction | null {
  if (s.dead >= 0) return null;
  const raw = deduceGlobal(knowledge(p, s), neighbourTable(p.w, p.h), mineCount(p));
  return raw && effective(s, raw);
}

export const forcedFlags: MinesTechnique = {
  id: "mines.forced",
  name: "no room to spare",
  puzzles: ["mines"],
  level: 1,
  description: "a number that has exactly as many hidden neighbours as mines it still needs: every one of those hidden neighbours is a mine. flag them.",
  find(p, s) {
    const d = singles(p, s, "mines")[0];
    if (!d) return null;
    const c = d.sources[0]!;
    const v = numbers(p)[c]!;
    const need = d.mines.length;
    const at = cellName(p, c);
    return {
      message: `the ${v} at ${at} needs ${need} more ${plural(need, "mine", "mines")} and has exactly ${need} hidden ${plural(need, "neighbour", "neighbours")}, so ${outcome(d)}`,
      nudge: `look at the ${v} at ${at}`,
      focus: focusOf(d),
      nudgeFocus: { cells: [], sources: [c] } satisfies MinesFocus,
      actions: actionsOf(d),
    };
  },
};

export const satisfied: MinesTechnique = {
  id: "mines.satisfied",
  name: "satisfied number",
  puzzles: ["mines"],
  level: 2,
  description: "a number already touching as many flags as it shows has all its mines, so its other hidden neighbours are safe. opening them all at once is what clicking an open number (chording) does.",
  find(p, s) {
    const d = singles(p, s, "safe")[0];
    if (!d) return null;
    const c = d.sources[0]!;
    const v = numbers(p)[c]!;
    const at = cellName(p, c);
    const has = v === 0 ? "touches no mines" : `already touches ${v} ${plural(v, "flag", "flags")}`;
    return {
      message: `the ${v} at ${at} ${has}, so ${outcome(d)}`,
      nudge: `look at the ${v} at ${at}`,
      focus: focusOf(d),
      nudgeFocus: { cells: [], sources: [c] } satisfies MinesFocus,
      actions: actionsOf(d),
    };
  },
};

export const mineCountTechnique: MinesTechnique = {
  id: "mines.count",
  name: "mine count",
  puzzles: ["mines"],
  level: 3,
  description: "the total number of mines is known. once they're all flagged, every other hidden cell is safe; if the hidden cells left are exactly as many as the mines left, they're all mines.",
  find(p, s) {
    const d = countDeduction(p, s);
    if (!d) return null;
    const left = d.remaining ?? 0;
    return {
      message: left === 0
        ? `all ${mineCount(p)} mines are flagged, so ${outcome(d)}`
        : `${left} ${plural(left, "mine is", "mines are")} left and exactly ${left} hidden ${plural(left, "cell", "cells")}, so ${outcome(d)}`,
      nudge: "count the mines left against the hidden cells left",
      focus: focusOf(d),
      actions: actionsOf(d),
    };
  },
  practice: { params: { width: 6, height: 6, mines: 8, difficulty: "easy" } },
};

export const overlap: MinesTechnique = {
  id: "mines.overlap",
  name: "overlapping numbers",
  puzzles: ["mines"],
  level: 4,
  description: "two nearby numbers that share some hidden neighbours. the shared cells can hold only so many of either number's mines, which settles the cells only one of them touches (the classic 1-1 and 1-2 patterns).",
  find(p, s) {
    const d = pairDeductions(p, s)[0];
    if (!d) return null;
    const nums = numbers(p);
    const [a, b] = d.sources as [number, number];
    return {
      message: `comparing the ${nums[a]} at ${cellName(p, a)} with the ${nums[b]} at ${cellName(p, b)}: ${outcome(d)}`,
      nudge: `compare the ${nums[a]} at ${cellName(p, a)} with a number next to it`,
      focus: focusOf(d),
      nudgeFocus: { cells: [], sources: [a] } satisfies MinesFocus,
      actions: actionsOf(d),
    };
  },
  practice: { params: { difficulty: "normal" } },
};

export const region: MinesTechnique = {
  id: "mines.region",
  name: "whole region",
  puzzles: ["mines"],
  level: 5,
  description: "list every way the mines could sit along a stretch of hidden cells next to opened numbers, together with how many mines are left in total. a cell that is the same in every possible way is decided.",
  find(p, s) {
    const d = regionDeduction(p, s);
    if (!d) return null;
    const first = d.sources[0];
    return {
      message: `trying every way the ${d.remaining} remaining mines can fit: ${outcome(d)}`,
      nudge: first === undefined ? "think about where the remaining mines can go" : `try every way the mines can fit near ${cellName(p, first)}`,
      focus: focusOf(d),
      nudgeFocus: { cells: [], sources: d.sources } satisfies MinesFocus,
      actions: actionsOf(d),
    };
  },
  practice: { params: { width: 12, height: 12, mines: 30, difficulty: "hard" } },
};

export const minesTechniques: MinesTechnique[] = [forcedFlags, satisfied, mineCountTechnique, overlap, region];

/** Cells provable right now with logic up to `maxLevel` (technique levels above). */
export function provable(p: MinesPuzzle, s: MinesState, maxLevel: number): { safe: number[]; mines: number[] } {
  const found: Deduction[] = [...singles(p, s, "mines"), ...singles(p, s, "safe")];
  const c = maxLevel >= 3 ? countDeduction(p, s) : null;
  if (c) found.push(c);
  if (!found.length && maxLevel >= 4) found.push(...pairDeductions(p, s));
  if (!found.length && maxLevel >= 5) {
    const r = regionDeduction(p, s);
    if (r) found.push(r);
  }
  return {
    safe: [...new Set(found.flatMap((d) => d.safe))],
    mines: [...new Set(found.flatMap((d) => d.mines))],
  };
}

export type { Step };
