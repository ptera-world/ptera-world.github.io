import { defineSchema } from "../../core/schema";
import type { Plugin } from "../../core/types";
import { info, type PatternAction, type PatternFocus, type PatternInteraction, type PatternPuzzle, type PatternState } from "./logic";
import { LINE_RULES } from "./rules";
import { EMPTY, FILLED, UNKNOWN, extremes, lineCells, lineClue, runs, solveLine, type Clue } from "./solver";
import { knowledge } from "./techniques";
import { BLOCK_RANGE_KEY, CLUE_DONE_KEY, LINE_ERRORS_KEY, MISTAKES_KEY, PROGRESS_KEY, type BlockRange, type ClueDone, type Progress } from "./view";

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

/** Cells whose mark disagrees with the solution, when the puzzle has a known unique one. */
export function wrongCells(p: PatternPuzzle, s: PatternState): number[] {
  const inf = info(p);
  const sol = inf.unique ? inf.solution : null;
  return sol ? s.cells.flatMap((v, i) => (v !== UNKNOWN && v !== sol[i] ? [i] : [])) : [];
}

/** Lines whose marks can't fit their clue. */
export function brokenLines(p: PatternPuzzle, cells: readonly number[]): number[] {
  const out: number[] = [];
  for (let l = 0; l < p.w + p.h; l++) if (!solveLine(lineClue(p, l), lineValues(cells, lineCells(p, l)))) out.push(l);
  return out;
}

/** Runs ahead of technique hints (priority 100), so a wrong mark is pointed out before any deduction. */
const checkMarks: PatternPlugin = {
  id: "pattern.check-marks",
  name: "hints check your marks first",
  description: "asking for a hint points out filled or crossed cells that don't match the solution before suggesting anything else",
  category: "assists",
  appliesTo: ["pattern"],
  enabledByDefault: true,
  setup({ session, owner }) {
    session.hooks.hint.tap(({ puzzle, state }) => {
      const wrong = wrongCells(puzzle, state);
      if (!wrong.length) return undefined;
      return {
        message: wrong.length === 1 ? "this mark is wrong" : `${wrong.length} marks are wrong`,
        focus: { cells: wrong } satisfies PatternFocus,
        actions: [{ type: "set", cells: wrong, value: UNKNOWN }],
      };
    }, { owner, priority: 90 });
  },
};

const clueDone: PatternPlugin = {
  id: "pattern.clue-done",
  name: "fade finished clue numbers",
  description: "fade clue numbers your marks already account for",
  category: "assists",
  appliesTo: ["pattern"],
  enabledByDefault: true,
  setup({ session, owner }) {
    session.hooks.derive.tap((d, { puzzle, state }) => {
      const done: ClueDone = { rows: [], cols: [] };
      for (let l = 0; l < puzzle.w + puzzle.h; l++) {
        const clue = lineClue(puzzle, l);
        const vals = lineValues(state.cells, lineCells(puzzle, l));
        // an empty clue is drawn as a single "0"
        const flags = clue.length ? doneNumbers(clue, vals) : [!vals.includes(FILLED)];
        if (l < puzzle.h) done.rows.push(flags);
        else done.cols.push(flags);
      }
      return { ...d, [CLUE_DONE_KEY]: done };
    }, { owner });
  },
};

/** Also fires a "mistake" effect when a move breaks a line that could still fit before. */
const lineErrors: PatternPlugin = {
  id: "pattern.line-errors",
  name: "flag impossible lines",
  description: "turn a clue red when the marks in its line can't fit it (only looks at the clue, never the solution)",
  category: "assists",
  appliesTo: ["pattern"],
  enabledByDefault: true,
  setup({ session, owner }) {
    session.hooks.derive.tap((d, { puzzle, state }) => ({ ...d, [LINE_ERRORS_KEY]: brokenLines(puzzle, state.cells) }), { owner });
    session.hooks.change.tap(({ prev, state, cause }) => {
      if (cause !== "action") return;
      const before = new Set(brokenLines(session.puzzle, prev.cells));
      const fresh = brokenLines(session.puzzle, state.cells).filter((l) => !before.has(l));
      if (fresh.length) session.hooks.fx.call({ kind: "mistake", focus: { lines: fresh, broken: fresh[0] } satisfies PatternFocus });
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
    session.hooks.derive.tap((d, { puzzle, state }) => ({ ...d, [MISTAKES_KEY]: wrongCells(puzzle, state) }), { owner });
  },
};

const completeLine = LINE_RULES.find((r) => r.id === "every")!.find;

const progress: PatternPlugin = {
  id: "pattern.progress",
  name: "show where progress is",
  description: "mark the lines where one line's logic decides something, or tint the exact cells",
  category: "assists",
  appliesTo: ["pattern"],
  enabledByDefault: false,
  settings: defineSchema({
    show: {
      type: "enum", label: "show", default: "lines",
      options: [
        { value: "lines", label: "which lines (a dot by the clue)" },
        { value: "cells", label: "which cells (tinted)" },
      ],
    },
  }),
  setup({ session, settings, owner }) {
    const cells = settings.show === "cells";
    session.hooks.derive.tap((d, { puzzle, state }) => {
      if (session.solved) return d;
      const K = knowledge(puzzle, state);
      const out: Progress = { lines: [], fill: [], empty: [] };
      for (let l = 0; l < puzzle.w + puzzle.h; l++) {
        const idx = lineCells(puzzle, l);
        const f = completeLine({ clue: lineClue(puzzle, l), vals: idx.map((c) => K[c]!) });
        const fill = f.fill.map((i) => idx[i]!).filter((c) => state.cells[c] === UNKNOWN);
        const empty = f.empty.map((i) => idx[i]!).filter((c) => state.cells[c] === UNKNOWN);
        if (!fill.length && !empty.length) continue;
        if (cells) {
          out.fill.push(...fill);
          out.empty.push(...empty);
        } else out.lines.push(l);
      }
      return { ...d, [PROGRESS_KEY]: out };
    }, { owner });
  },
};

/** Display-only: the view sets interaction.clue while the player points at a clue number. */
const blockRange: PatternPlugin = {
  id: "pattern.block-range",
  name: "show where a block can go",
  description: "point at or tap a clue number to shade every cell its block can still reach, darker where it lands however it sits",
  category: "assists",
  appliesTo: ["pattern"],
  enabledByDefault: true,
  setup({ session, owner }) {
    session.hooks.derive.tap((d, { puzzle, state, interaction }) => {
      const ref = interaction?.clue;
      if (!ref) return d;
      const clue = lineClue(puzzle, ref.line);
      if (ref.block < 0 || ref.block >= clue.length) return d;
      const idx = lineCells(puzzle, ref.line);
      const ext = extremes(clue, lineValues(state.cells, idx));
      const len = clue[ref.block]!;
      const range: BlockRange = ext
        ? { ...ref, reach: [ext.left[ref.block]!, ext.right[ref.block]! + len], sure: [ext.right[ref.block]!, ext.left[ref.block]! + len] }
        : { ...ref, reach: null, sure: null };
      return { ...d, [BLOCK_RANGE_KEY]: range };
    }, { owner });
  },
};

export const patternPlugins: PatternPlugin[] = [checkMarks, clueDone, lineErrors, mistakes, progress, blockRange];
