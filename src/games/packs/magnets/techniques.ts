import type { Step, Technique } from "../../core/types";
import { bit, valueOf, type Deduction } from "../../lib/grid-kit/csp";
import { cellList, cellName, technique, type Focus, type Reading } from "../../lib/grid-kit/names";
import {
  magnets, A_MINUS, A_PLUS, FULL, MAGNET, NEUTRAL, SIGN_WORD, geometry, lineName, model, readMasks, signAt,
  type MagnetsAction, type MagnetsPuzzle, type MagnetsState,
} from "./logic";

type MagnetsTechnique = Technique<MagnetsPuzzle, MagnetsState, MagnetsAction>;

const readings = new WeakMap<MagnetsState, Reading>();

/** Board masks. */
function read(p: MagnetsPuzzle, s: MagnetsState): Reading {
  let r = readings.get(s);
  if (!r) readings.set(s, r = { model: model(p), k: readMasks(p, s) });
  return r;
}

/** Dominoes whose board mask the deduction narrows. */
function changes(p: MagnetsPuzzle, s: MagnetsState, d: Deduction): number[] {
  return d.vars.filter((v) => {
    const m = s.doms[v]!;
    const next = m & d.keep;
    return next !== 0 && next !== m;
  });
}

/** What the board will say about a domino with mask m. */
function outcome(p: MagnetsPuzzle, d: number, m: number): string {
  const g = geometry(p);
  const [a, b] = g.dominoes[d]!;
  const A = cellName(p, a), B = cellName(p, b);
  if (m === bit(NEUTRAL)) return `the domino on ${A} and ${B} is blank`;
  if (m === bit(A_PLUS)) return `${A} is plus and ${B} is minus`;
  if (m === bit(A_MINUS)) return `${A} is minus and ${B} is plus`;
  if (m === MAGNET) return `the domino on ${A} and ${B} is a magnet`;
  const gone = valueOf(FULL & ~m);
  return `${A} can't be ${SIGN_WORD[signAt(g, a, gone)]} and ${B} can't be ${SIGN_WORD[signAt(g, b, gone)]}`;
}

function step(p: MagnetsPuzzle, s: MagnetsState, d: Deduction, vars: number[], why: string, nudge: string, nudgeFocus: Focus, extra: Partial<Focus> = {}): Step<MagnetsAction> {
  const g = geometry(p);
  const results = vars.map((v) => outcome(p, v, s.doms[v]! & d.keep));
  return {
    message: `${why}, so ${results.length > 2 ? `${results.slice(0, 2).join(", ")} and more` : results.join(" and ")}`,
    nudge,
    focus: { cells: vars.flatMap((v) => g.dominoes[v]!), because: extra.because ?? d.because, related: extra.related ?? d.related ?? [] } satisfies Focus,
    nudgeFocus,
    actions: [{ type: "narrow", doms: vars, keep: d.keep }],
  };
}

/** True if the deduction narrows the target cell's domino or comes from that cell. */
const aim = (p: MagnetsPuzzle, d: Deduction, vars: number[], target: unknown): boolean => {
  if (typeof target !== "number") return false;
  const g = geometry(p);
  const dom = g.domOf[target];
  return (dom !== undefined && dom >= 0 && vars.includes(dom)) || d.because.includes(target);
};

const dataOf = (d: Deduction) => d.data as { line: number; sign: number; cell?: number };
const base = { puzzle: magnets, read, changes, aim };

export const poles: MagnetsTechnique = technique<MagnetsPuzzle, MagnetsState, MagnetsAction>({
  ...base,
  id: "magnets.poles",
  name: "like poles",
  level: 1,
  kinds: ["poles"],
  description: "two plus ends can't touch, and neither can two minus ends. a cell next to a plus can't be plus, and a cell next to a minus can't be minus.",
  explain(p, s, d, vars) {
    const src = d.because[0]!, dst = d.related![0]!;
    const sign = SIGN_WORD[dataOf(d).sign];
    return step(p, s, d, vars, `${cellName(p, src)} is ${sign} and ${cellName(p, dst)} touches it`, `look around ${cellName(p, src)}`, { cells: [], because: [src] }, { related: [dst] });
  },
  practice: { params: { width: 6, height: 5, difficulty: "easy" } },
});

const countWhy = (p: MagnetsPuzzle, d: Deduction) => {
  const { line, sign } = dataOf(d);
  const word = sign === 0 ? "blank cells" : `${SIGN_WORD[sign]} ends`;
  return { line: lineName(p, line), word };
};

export const countFull: MagnetsTechnique = technique<MagnetsPuzzle, MagnetsState, MagnetsAction>({
  ...base,
  id: "magnets.count-full",
  name: "line full",
  level: 2,
  kinds: ["count-full"],
  description: "a row or column that already has as many plus ends as its number can't take another plus anywhere else; the same goes for minus ends, and for blanks when both numbers are known.",
  explain(p, s, d, vars) {
    const { line, word } = countWhy(p, d);
    return step(p, s, d, vars, `${line} already has all its ${word}`, `count the ${word} in ${line}`, { cells: [], because: [], related: d.related });
  },
  practice: { params: { width: 6, height: 5, difficulty: "easy" } },
});

export const countAll: MagnetsTechnique = technique<MagnetsPuzzle, MagnetsState, MagnetsAction>({
  ...base,
  id: "magnets.count-all",
  name: "every spot needed",
  level: 3,
  kinds: ["count-all"],
  description: "a row or column with exactly as many cells that could still be plus as plus ends it still needs: every one of them is plus. the same goes for minus, and for blanks.",
  explain(p, s, d, vars) {
    const { line, word } = countWhy(p, d);
    return step(p, s, d, vars, `${line} needs every cell that could still hold its ${word}`, `count the ${word} ${line} still needs`, { cells: [], because: [], related: d.related });
  },
  practice: { params: { width: 6, height: 5, difficulty: "easy" } },
});

export const dominoes: MagnetsTechnique = technique<MagnetsPuzzle, MagnetsState, MagnetsAction>({
  ...base,
  id: "magnets.dominoes",
  name: "whole magnets",
  level: 4,
  kinds: ["dominoes-full", "dominoes-all"],
  description: "count by dominoes instead of cells: a domino lying along a line gives it at most one plus and one minus, and a magnet across it gives exactly one end. if the line's number is the least (or most) its dominoes can give, each domino must give the least (or most) it can.",
  explain(p, s, d, vars) {
    const { line, word } = countWhy(p, d);
    const how = d.kind === "dominoes-full" ? "already the fewest" : "the most";
    return step(p, s, d, vars, `counting whole dominoes, the ${word} ${line} needs are ${how} its dominoes can give`, `count the ${word} in ${line} domino by domino`, { cells: [], because: [], related: d.related });
  },
  practice: { params: { width: 6, height: 5, difficulty: "tricky" } },
});

export const trial: MagnetsTechnique = technique<MagnetsPuzzle, MagnetsState, MagnetsAction>({
  ...base,
  id: "magnets.trial",
  name: "try it both ways",
  level: 5,
  kinds: ["trial"],
  description: "pretend a domino is blank, or a magnet one way round, and follow the other techniques from there. if that breaks a rule, the domino can't be that.",
  explain(p, s, d, vars) {
    const g = geometry(p);
    const [a, b] = g.dominoes[vars[0]!]!;
    const tried = (d.data as { value: number }).value;
    const what = tried === NEUTRAL ? "blank" : `turned with ${cellName(p, a)} ${SIGN_WORD[signAt(g, a, tried)]}`;
    return step(p, s, d, vars, `if the domino on ${cellName(p, a)} and ${cellName(p, b)} were ${what}, following the other techniques would break a rule`,
      `try the domino on ${cellList(p, [a, b])} each way`, { cells: [a, b], because: [] });
  },
  practice: { params: { width: 8, height: 7, difficulty: "hard" } },
});

export const magnetsTechniques: MagnetsTechnique[] = [poles, countFull, countAll, dominoes, trial];
