import type { Step, Technique } from "../../core/types";
import { cellName as cellAt, plural } from "../../lib/grid-kit/names";
import { info, type PatternAction, type PatternFocus, type PatternPuzzle, type PatternState, type PatternTarget, type GuideSpan } from "./logic";
import { ruleOnLine, type LineFind, type LineRuleId } from "./rules";
import { EMPTY, FILLED, Lines, UNKNOWN, findProbe, lineClue, lineName } from "./solver";

type PatternTechnique = Technique<PatternPuzzle, PatternState, PatternAction>;

/**
 * The marks deductions start from: the player's marks, minus any that contradict a known unique
 * solution. A wrong mark therefore never leads an applied step astray (and the mistake check
 * points it out first).
 */
export function knowledge(p: PatternPuzzle, s: PatternState): Uint8Array {
  const inf = info(p);
  const sol = inf.unique ? inf.solution : null;
  const K = Uint8Array.from(s.cells);
  if (sol) for (let c = 0; c < K.length; c++) if (K[c] !== UNKNOWN && K[c] !== sol[c]) K[c] = UNKNOWN;
  return K;
}

export interface LineHit {
  line: number;
  cells: Int32Array;
  find: LineFind;
}

/** Every line where rule `id` adds something, given knowledge K. */
export function ruleHits(p: PatternPuzzle, K: ArrayLike<number>, id: LineRuleId, s?: PatternState): LineHit[] {
  const L = info(p).lines;
  const out: LineHit[] = [];
  for (let l = 0; l < L.count; l++) {
    const cells = L.cells[l]!;
    const vals = Array.from(cells, (c) => K[c]!);
    const f = ruleOnLine(id, { clue: lineClue(p, l), vals });
    if (!f) continue;
    // only cells still blank on the board (knowledge may have blanked a wrong mark)
    const blank = (i: number) => !s || s.cells[cells[i]!] === UNKNOWN;
    const find = { ...f, fill: f.fill.filter(blank), empty: f.empty.filter(blank) };
    if (find.fill.length || find.empty.length) out.push({ line: l, cells, find });
  }
  return out;
}

/** The line with the most to gain; ties go to the first line (rows, then columns). */
function best(hits: LineHit[]): LineHit | null {
  let b: LineHit | null = null;
  for (const x of hits) if (!b || x.find.fill.length + x.find.empty.length > b.find.fill.length + b.find.empty.length) b = x;
  return b;
}

function actionsOf(fill: number[], empty: number[]): PatternAction[] {
  const out: PatternAction[] = [];
  if (fill.length) out.push({ type: "set", cells: fill, value: FILLED });
  if (empty.length) out.push({ type: "set", cells: empty, value: EMPTY });
  return out;
}


function outcome(fill: number, empty: number): string {
  const parts: string[] = [];
  if (fill) parts.push(fill === 1 ? "that cell is filled" : `those ${fill} cells are filled`);
  if (empty) parts.push(empty === 1 ? "that cell is empty" : `those ${empty} cells are empty`);
  return parts.join(" and ");
}

const clueText = (clue: readonly number[]) => (clue.length ? clue.join(" ") : "0");
const blockText = (clue: readonly number[], blocks: number[]) => {
  const names = blocks.map((j) => `the ${clue[j]}`);
  return names.length <= 1 ? names.join("") : `${names.slice(0, -1).join(", ")} and ${names[names.length - 1]}`;
};

/** What the guide marks drawn for a step mean, as a trailing sentence (or ""). */
function legend(row: boolean, id: LineRuleId, f: LineFind): string {
  const kinds = new Set(f.spans.map((s) => s.kind));
  const parts: string[] = [];
  if (kinds.has("left")) parts.push(row ? "upper bars: blocks pushed left, lower bars: pushed right" : "left bars: blocks pushed up, right bars: pushed down");
  if (kinds.has("reach")) parts.push("dashed bars: how far each block can reach");
  if (kinds.has("place")) parts.push("bars: the only way the blocks fit");
  if (f.sources.length) parts.push(id === "capped" ? "dashed outline: the run" : "dashed outlines: the marks this uses");
  return parts.length ? ` ${parts.join("; ")}.` : "";
}

const targetOf = (t: unknown): PatternTarget | null =>
  t && typeof t === "object" && Array.isArray((t as PatternTarget).lines) ? t as PatternTarget : null;

/** A line rule as a technique: one line per step, chosen by most cells decided (among the target's lines when aimed). */
function lineTechnique(
  id: LineRuleId,
  def: Omit<PatternTechnique, "find" | "puzzles"> & { explain(p: PatternPuzzle, line: number, f: LineFind): string },
): PatternTechnique {
  const { explain, ...rest } = def;
  const stepOf = (p: PatternPuzzle, hit: LineHit | null): Step<PatternAction> | null => {
    if (!hit) return null;
    const { line, cells, find } = hit;
    const at = (i: number) => cells[i]!;
    const fill = find.fill.map(at), empty = find.empty.map(at);
    const spans: GuideSpan[] = find.spans.map((x) => ({ ...x, line }));
    const focus: PatternFocus = {
      lines: [line], cells: [...fill, ...empty], sources: find.sources.map(at),
      clues: find.blocks.map((block) => ({ line, block })), spans,
    };
    return {
      message: `${explain(p, line, find)}, so ${outcome(fill.length, empty.length)}.${legend(line < p.h, id, find)}`,
      nudge: `look at ${lineName(p, line)}`,
      focus,
      nudgeFocus: { lines: [line] } satisfies PatternFocus,
      actions: actionsOf(fill, empty),
    };
  };
  return {
    ...rest,
    puzzles: ["pattern"],
    find: (p, s) => stepOf(p, best(ruleHits(p, knowledge(p, s), id, s))),
    findAt(p, s, t) {
      const target = targetOf(t);
      if (!target) return null;
      return stepOf(p, best(ruleHits(p, knowledge(p, s), id, s).filter((h) => target.lines.includes(h.line))));
    },
  };
}

export const finishedLine = lineTechnique("finished", {
  id: "pattern.finished",
  name: "finished line",
  level: 1,
  description: "a line whose filled runs already match its clue has nothing else to fill: cross out the rest of it. a 0 clue means the whole line is empty.",
  defaults: { auto: true },
  explain: (p, l) => `${lineName(p, l)} already shows its whole clue (${clueText(lineClue(p, l))})`,
});

export const exactFit = lineTechnique("exact", {
  id: "pattern.exact",
  name: "exact fit",
  level: 2,
  description: "add up the clue plus one gap between each pair of numbers. if that equals the length of the line, the clue fits only one way: fill it in, with single gaps.",
  explain: (p, l) => {
    const clue = lineClue(p, l);
    const n = l < p.h ? p.w : p.h;
    return `${lineName(p, l)}'s clue ${clueText(clue)} plus ${clue.length - 1} ${plural(clue.length - 1, "gap", "gaps")} takes exactly ${n} cells, the whole line`;
  },
  practice: { params: { width: 8, height: 8, density: 65, smoothing: 1, difficulty: "easy" } },
});

export const overlap = lineTechnique("overlap", {
  id: "pattern.overlap",
  name: "overlap",
  level: 3,
  description: "imagine every block of the clue pushed as far left as it fits (crossed cells and the other blocks get in the way), then as far right. if a block covers some cells in both positions, those cells are filled however it really sits. big numbers in short lines overlap the most.",
  explain: (p, l, f) => `pushing the blocks to either end of ${lineName(p, l)}, ${blockText(lineClue(p, l), f.blocks)} ${plural(f.blocks.length, "covers", "cover")} the same cells both ways`,
});

export const cappedRun = lineTechnique("capped", {
  id: "pattern.capped",
  name: "complete block",
  level: 4,
  description: "a run of filled cells that can only belong to clue numbers of exactly its length is a whole block already. the cells just before and after it are empty.",
  explain: (p, l, f) => {
    const clue = lineClue(p, l);
    const len = clue[f.blocks[0]!]!;
    return `the run of ${len} in ${lineName(p, l)} can only be ${f.blocks.length === 1 ? `the ${len}` : `one of its ${len}s`}, so it's already complete`;
  },
  practice: { params: { width: 10, height: 10, difficulty: "easy" } },
});

export const outOfReach = lineTechnique("reach", {
  id: "pattern.reach",
  name: "out of reach",
  level: 6,
  description: "slide each block as far as it can go each way without breaking the marks already in the line. cells that no block can reach are empty.",
  explain: (p, l) => `no block of ${lineName(p, l)}'s clue can reach those cells`,
  practice: { params: { width: 15, height: 15, density: 35, smoothing: 0, difficulty: "easy" } },
});

export const sliding = lineTechnique("slide", {
  id: "pattern.slide",
  name: "sliding blocks",
  level: 5,
  description: "overlap again, but now the filled cells already in the line also limit how far each block can slide. a filled cell near an edge pulls the first block onto it; a cross can stop a block from fitting somewhere. whatever a block covers at both ends of its slide is filled.",
  explain: (p, l, f) => `with the marks already in ${lineName(p, l)}, ${blockText(lineClue(p, l), f.blocks)} can only slide so far, and ${plural(f.blocks.length, "covers", "cover")} the same cells at both ends`,
  practice: { params: { width: 15, height: 15, difficulty: "easy" } },
});

export const everyWay = lineTechnique("every", {
  id: "pattern.every",
  name: "every arrangement",
  level: 7,
  description: "list every way the clue fits the line's marks. a cell that is filled in all of them, or empty in all of them, is decided. this is everything one line can tell you on its own.",
  explain: (p, l, f) => `${lineName(p, l)}'s clue fits its marks ${f.ways === undefined ? "only a few" : f.ways >= 1e6 ? "a huge number of" : String(f.ways)} ${plural(f.ways ?? 2, "way", "ways")}, and they all agree on those cells`,
  practice: { params: { width: 15, height: 15, difficulty: "hard", smoothing: 0 } },
});

const word = (v: number) => (v === FILLED ? "filled" : "empty");

export const whatIf: PatternTechnique = {
  id: "pattern.what-if",
  name: "what if",
  puzzles: ["pattern"],
  level: 8,
  description: "when no single line says anything more, pick a cell and suppose it's filled (or empty). follow the line logic that suppose leads to. if some line ends up with no way to fit its clue, the supposition was wrong, so the cell is the other way.",
  find: (p, s) => whatIfStep(p, s),
  findAt(p, s, t) {
    const cell = targetOf(t)?.cell;
    return cell === undefined ? null : whatIfStep(p, s, cell);
  },
  practice: { params: { width: 10, height: 10, difficulty: "hard" } },
};

/** A what-if anywhere, or only at `at`. */
function whatIfStep(p: PatternPuzzle, s: PatternState, at?: number): Step<PatternAction> | null {
  const K = knowledge(p, s);
  const L: Lines = info(p).lines;
  const probe = at === undefined ? findProbe(L, K) : findProbe(L, K, at, 1);
  if (!probe || s.cells[probe.cell] !== UNKNOWN) return null;
  const other = probe.tried === FILLED ? EMPTY : FILLED;
  const fill: number[] = [], empty: number[] = [];
  probe.after.forEach((v, c) => {
    if (K[c] !== UNKNOWN || c === probe.cell) return;
    if (v === FILLED) fill.push(c);
    else if (v === EMPTY) empty.push(c);
  });
  const name = cellAt(p, probe.cell);
  return {
    message: `if ${name} were ${word(probe.tried)}, line logic from there (the faded marks) leaves ${lineName(p, probe.failedLine)} no way to fit its clue, so ${name} is ${word(other)}`,
    nudge: `suppose something about ${name} and follow where it leads`,
    focus: {
      cells: [probe.cell], lines: [probe.failedLine], broken: probe.failedLine,
      suppose: { cell: probe.cell, value: probe.tried, fill, empty },
    } satisfies PatternFocus,
    nudgeFocus: { cells: [probe.cell] } satisfies PatternFocus,
    actions: [{ type: "set", cells: [probe.cell], value: other }],
  };
}

export const patternTechniques: PatternTechnique[] = [finishedLine, exactFit, overlap, cappedRun, sliding, outOfReach, everyWay, whatIf];
