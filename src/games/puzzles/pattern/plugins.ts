import type { Plugin } from "../../core/types";
import { info, type PatternAction, type PatternInteraction, type PatternPuzzle, type PatternState } from "./logic";
import { EMPTY, FILLED, UNKNOWN, lineCells, lineClue, runs, solveLine, type Clue } from "./solver";
import { CLUE_DONE_KEY, LINE_ERRORS_KEY, MISTAKES_KEY, type ClueDone } from "./view";

type PatternPlugin = Plugin<PatternPuzzle, PatternState, PatternAction, PatternInteraction>;

function lineValues(cells: readonly number[], idx: readonly number[]): number[] {
  return idx.map((i) => cells[i]!);
}

function matches(clue: Clue, vals: readonly number[]): boolean {
  const r = runs(vals);
  return r.length === clue.length && r.every((n, i) => n === clue[i]);
}

/**
 * Which clue numbers are provably satisfied by the player's marks: all of them when the filled
 * runs equal the clue, else those matched by complete runs inside the fully-decided prefix and
 * suffix of the line.
 */
export function doneNumbers(clue: Clue, vals: readonly number[]): boolean[] {
  const k = clue.length;
  const done = Array.from({ length: k }, () => false);
  if (matches(clue, vals)) return done.fill(true);
  const n = vals.length;
  const scan = (dir: 1 | -1) => {
    let i = dir === 1 ? 0 : n - 1;
    let j = dir === 1 ? 0 : k - 1;
    const inside = (x: number) => x >= 0 && x < n;
    while (inside(i)) {
      if (vals[i] === EMPTY) { i += dir; continue; }
      if (vals[i] === UNKNOWN) return;
      let e = i, len = 0;
      while (inside(e) && vals[e] === FILLED) { e += dir; len++; }
      if (inside(e) && vals[e] !== EMPTY) return;
      if (j < 0 || j >= k || clue[j] !== len) return;
      done[j] = true;
      j += dir;
      i = e;
    }
  };
  scan(1);
  scan(-1);
  return done;
}

const autoCross: PatternPlugin = {
  id: "pattern.auto-cross",
  name: "auto-cross finished lines",
  description: "when filling a cell makes a line match its clue, cross the rest of that line",
  category: "assists",
  appliesTo: ["pattern"],
  enabledByDefault: true,
  setup({ session, owner }) {
    session.hooks.apply.tap((next, { prev, action, puzzle, reduce }) => {
      if (action && next === prev) return next;
      const lines = new Set<number>();
      next.cells.forEach((v, i) => {
        if (v === FILLED && (!action || prev.cells[i] !== FILLED)) {
          lines.add(Math.floor(i / puzzle.w));
          lines.add(puzzle.h + (i % puzzle.w));
        }
      });
      let out = next;
      for (const l of lines) {
        const idx = lineCells(puzzle, l);
        if (!matches(lineClue(puzzle, l), lineValues(out.cells, idx))) continue;
        const rest = idx.filter((i) => out.cells[i] === UNKNOWN);
        if (rest.length) out = reduce(out, { type: "set", cells: rest, value: EMPTY });
      }
      return out;
    }, { owner });
  },
};

const clueDone: PatternPlugin = {
  id: "pattern.clue-done",
  name: "dim finished clues",
  description: "fade clue numbers your marks already account for",
  category: "assists",
  appliesTo: ["pattern"],
  enabledByDefault: true,
  setup({ session, owner }) {
    session.hooks.derive.tap((d, { puzzle, state }) => {
      const done: ClueDone = { rows: [], cols: [] };
      for (let l = 0; l < puzzle.w + puzzle.h; l++) {
        const flags = doneNumbers(lineClue(puzzle, l), lineValues(state.cells, lineCells(puzzle, l)));
        if (l < puzzle.h) done.rows.push(flags);
        else done.cols.push(flags);
      }
      return { ...d, [CLUE_DONE_KEY]: done };
    }, { owner });
  },
};

const lineErrors: PatternPlugin = {
  id: "pattern.line-errors",
  name: "flag impossible lines",
  description: "mark a clue red when the marks in its line can't fit it (doesn't look at the solution)",
  category: "assists",
  appliesTo: ["pattern"],
  enabledByDefault: true,
  setup({ session, owner }) {
    session.hooks.derive.tap((d, { puzzle, state }) => {
      const bad: number[] = [];
      for (let l = 0; l < puzzle.w + puzzle.h; l++) {
        if (!solveLine(lineClue(puzzle, l), lineValues(state.cells, lineCells(puzzle, l)))) bad.push(l);
      }
      return { ...d, [LINE_ERRORS_KEY]: bad };
    }, { owner });
  },
};

const mistakes: PatternPlugin = {
  id: "pattern.mistakes",
  name: "show mistakes",
  description: "highlight marks that disagree with the solution",
  category: "checks",
  appliesTo: ["pattern"],
  enabledByDefault: false,
  setup({ session, owner }) {
    session.hooks.derive.tap((d, { puzzle, state }) => {
      const inf = info(puzzle);
      const sol = inf.unique ? inf.solution : null;
      if (!sol) return d;
      const wrong = state.cells.flatMap((v, i) => (v !== UNKNOWN && v !== sol[i] ? [i] : []));
      return { ...d, [MISTAKES_KEY]: wrong };
    }, { owner });
  },
};

export const plugins: PatternPlugin[] = [autoCross, clueDone, lineErrors, mistakes];
