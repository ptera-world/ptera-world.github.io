import type { Step, Technique } from "../../core/types";
import { isSingle, valueOf, valuesOf, type Deduction } from "../../lib/grid-kit/csp";
import { cellList, cellName, technique, type Focus, type Reading, type TechniqueSpec } from "../../lib/grid-kit/names";
import {
  DIGIT_MASK, geometry, kakuro, model, readMasks, runName,
  type KakuroAction, type KakuroPuzzle, type KakuroState,
} from "./logic";

type KakuroTechnique = Technique<KakuroPuzzle, KakuroState, KakuroAction>;

const readings = new WeakMap<KakuroState, Reading>();

/** Board digits and notes. */
function read(p: KakuroPuzzle, s: KakuroState): Reading {
  let r = readings.get(s);
  if (!r) readings.set(s, r = { model: model(p), k: readMasks(p, s) });
  return r;
}

/** Cells whose board mask the deduction narrows. */
function changes(p: KakuroPuzzle, s: KakuroState, d: Deduction): number[] {
  return d.vars.filter((c) => {
    if (!p.white[c]) return false;
    const m = s.doms[c]!;
    const next = m & d.keep;
    return next !== 0 && next !== m;
  });
}

/** "1+2+4" */
const comboText = (m: number) => valuesOf(m).join("+");

function step(p: KakuroPuzzle, s: KakuroState, d: Deduction, vars: number[], why: string, nudge: string, nudgeFocus: Focus): Step<KakuroAction> {
  const placed = vars.filter((c) => isSingle(s.doms[c]! & d.keep));
  const rest = vars.filter((c) => !placed.includes(c));
  const parts = [
    ...placed.slice(0, 3).map((c) => `${cellName(p, c)} is ${valueOf(s.doms[c]! & d.keep)}`),
    ...(rest.length ? [`${cellList(p, rest)} can only be ${valuesOf(d.keep & DIGIT_MASK).join(", ")}`] : []),
  ];
  return {
    message: `${why}, so ${parts.join(", and ")}`,
    nudge,
    focus: { cells: vars, because: d.because, related: d.related ?? [] } satisfies Focus,
    nudgeFocus,
    actions: [{ type: "narrow", cells: vars, keep: d.keep }],
  };
}

const runOf = (p: KakuroPuzzle, d: Deduction) => geometry(p).runs[(d.data as { run: number }).run]!;
/** A white cell narrowed to one of its runs (see ViewHandle.targetAlong). */
export interface KakuroLineTarget { cell: number; run: number }

const isLine = (t: unknown): t is KakuroLineTarget =>
  !!t && typeof (t as KakuroLineTarget).cell === "number" && typeof (t as KakuroLineTarget).run === "number";

const comesFrom = (d: Deduction, c: number, vars: number[]) => vars.includes(c) || d.because.includes(c);

/**
 * A technique aimed at a cell (every deduction from or about it) or at a cell narrowed to one run
 * (only that run's deductions; one about a single cell and no run is on no run).
 */
function aimed(spec: TechniqueSpec<KakuroPuzzle, KakuroState, KakuroAction>): KakuroTechnique {
  return technique<KakuroPuzzle, KakuroState, KakuroAction>({
    ...spec,
    aim(_p, d, vars, target) {
      if (typeof target === "number") return comesFrom(d, target, vars);
      if (!isLine(target)) return false;
      return comesFrom(d, target.cell, vars) && (d.data as { run?: number } | undefined)?.run === target.run;
    },
    spot: (_p, target) => (typeof target === "number" ? target : isLine(target) ? target.cell : null),
  });
}

const base = { puzzle: kakuro, read, changes };
const EASY = { width: 6, height: 6, difficulty: "easy" };
const MEDIUM = { width: 6, height: 6, difficulty: "medium" };

export const lastCell: KakuroTechnique = aimed({
  ...base,
  id: "kakuro.last-cell",
  name: "last cell",
  level: 1,
  kinds: ["last-cell"],
  description: "when every cell of a run but one has its digit, the last cell is whatever the sum still needs.",
  explain(p, s, d, vars) {
    const r = runOf(p, d);
    return step(p, s, d, vars, `${runName(p, r)} has all its other digits, and ${(d.data as { value: number }).value} makes up the rest of the sum`, `which run has only one empty cell?`, { cells: [], because: [r.clue] });
  },
  practice: { params: EASY },
});

export const noRepeat: KakuroTechnique = aimed({
  ...base,
  id: "kakuro.no-repeat",
  name: "no repeats",
  level: 2,
  kinds: ["no-repeat"],
  description: "a digit already placed in a run can't appear again anywhere in that run.",
  explain(p, s, d, vars) {
    const r = runOf(p, d);
    const taken = d.because.map((c) => valueOf(s.doms[c]!)).join(" and ");
    return step(p, s, d, vars, `${runName(p, r)} already has ${taken} on ${cellList(p, d.because)}`, `look for a digit placed twice in one run`, { cells: vars, because: [] });
  },
  practice: { params: EASY },
});

export const combos: KakuroTechnique = aimed({
  ...base,
  id: "kakuro.combos",
  name: "sum combinations",
  level: 3,
  kinds: ["combos"],
  description: "only some sets of different digits add up to a sum in that many cells (3 in two cells is only 1+2). a cell in the run can only hold digits from a set that still fits.",
  explain(p, s, d, vars) {
    const r = runOf(p, d);
    const list = (d.data as { combos: number[] }).combos;
    const sets = list.length <= 3 ? list.map(comboText).join(" or ") : `${list.length} sets of digits`;
    return step(p, s, d, vars, `${r.cells.length} different digits making ${runName(p, r)} can only be ${sets}`, `which sum leaves few ways to make it?`, { cells: [], because: [r.clue] });
  },
  practice: { params: EASY },
});

export const fit: KakuroTechnique = aimed({
  ...base,
  id: "kakuro.fit",
  name: "fitting the digits in",
  level: 4,
  kinds: ["fit"],
  description: "a run's digits must go one to each cell. if a digit in one cell would leave the other cells unable to take the rest of any set that makes the sum, that cell can't hold it.",
  explain(p, s, d, vars) {
    const r = runOf(p, d);
    const list = (d.data as { combos: number[] }).combos;
    const sets = list.length <= 3 ? ` (${list.map(comboText).join(" or ")})` : "";
    return step(p, s, d, vars, `with the digits ${cellList(p, d.because)} can still take, only some digits on ${cellName(p, vars[0]!)} let ${runName(p, r)} be finished${sets}`, `how do the digits of ${runName(p, r)} fit into its cells?`, { cells: [], because: [r.clue] });
  },
  practice: { params: MEDIUM },
});

export const trial: KakuroTechnique = aimed({
  ...base,
  id: "kakuro.trial",
  name: "try it both ways",
  level: 5,
  kinds: ["trial"],
  description: "pretend a cell holds a digit and follow the other techniques from there. if that breaks a rule, it can't hold that digit.",
  explain(p, s, d, vars) {
    const c = vars[0]!;
    const v = (d.data as { value: number }).value;
    return step(p, s, d, vars, `if ${cellName(p, c)} were ${v}, following the other techniques would break a rule`, `try digits in ${cellName(p, c)}`, { cells: [c], because: [] });
  },
  practice: { params: { width: 6, height: 6, difficulty: "hard" } },
});

export const kakuroTechniques: KakuroTechnique[] = [lastCell, noRepeat, combos, fit, trial];
