import {
  EMPTY, FILLED, UNKNOWN, CAN_EMPTY, CAN_FILL, countArrangements, extremes, solveLine, type Clue, type Extremes,
} from "./solver";

/**
 * Single-line deduction rules, from the most obvious to complete line logic. Positions are
 * indices within the line. Every rule is sound: what it decides holds in every arrangement of
 * the clue consistent with the line's marks. Rules only decide UNKNOWN positions.
 */

/** A placement drawn as a guide: block `block` covering positions [from, to). */
export interface Span {
  block: number;
  from: number;
  to: number;
  /** left/right: pushed as far as it goes that way; reach: everywhere it could be; place: its only spot. */
  kind: "left" | "right" | "reach" | "place";
}

export interface LineFind {
  fill: number[];
  empty: number[];
  /** Clue numbers (block indices) the reasoning is about. */
  blocks: number[];
  spans: Span[];
  /** Positions of existing marks the reasoning leans on. */
  sources: number[];
  /** Arrangements consistent with the line, when the rule counted them. */
  ways?: number;
}

export interface Line {
  clue: Clue;
  vals: ArrayLike<number>;
}

export type LineRuleId = "finished" | "exact" | "overlap" | "capped" | "reach" | "slide" | "every";

const none = (): LineFind => ({ fill: [], empty: [], blocks: [], spans: [], sources: [] });
const unknowns = (vals: ArrayLike<number>, list: Iterable<number>) => [...list].filter((i) => vals[i] === UNKNOWN);
const range = (a: number, b: number) => Array.from({ length: Math.max(0, b - a) }, (_, i) => a + i);
const all = (k: number) => range(0, k);

/** Filled runs as [start, end) pairs. */
export function runSpans(vals: ArrayLike<number>): [number, number][] {
  const out: [number, number][] = [];
  for (let i = 0; i < vals.length; i++) {
    if (vals[i] !== FILLED) continue;
    const s = i;
    while (i < vals.length && vals[i] === FILLED) i++;
    out.push([s, i]);
  }
  return out;
}

/** The filled runs already are the clue, so nothing else in the line is filled. */
function finished({ clue, vals }: Line): LineFind {
  const r = runSpans(vals);
  if (r.length !== clue.length || r.some(([s, e], j) => e - s !== clue[j])) return none();
  const empty = unknowns(vals, range(0, vals.length));
  return { ...none(), empty, blocks: all(clue.length), sources: r.flatMap(([s, e]) => range(s, e)) };
}

/** The clue with single gaps is exactly the line's length: one possible arrangement. */
function exact({ clue, vals }: Line): LineFind {
  const n = vals.length;
  if (!clue.length || clue.reduce((a, b) => a + b, 0) + clue.length - 1 !== n) return none();
  const fill: number[] = [], empty: number[] = [], spans: Span[] = [];
  let at = 0;
  clue.forEach((len, j) => {
    spans.push({ block: j, from: at, to: at + len, kind: "place" });
    fill.push(...range(at, at + len));
    if (at + len < n) empty.push(at + len);
    at += len + 1;
  });
  return { ...none(), fill: unknowns(vals, fill), empty: unknowns(vals, empty), blocks: all(clue.length), spans };
}

/** Cells block j covers wherever it sits between its extremes. */
function overlapOf(clue: Clue, vals: ArrayLike<number>, ext: Extremes, sources: number[]): LineFind {
  const out = none();
  out.sources = sources;
  for (let j = 0; j < clue.length; j++) {
    const len = clue[j]!, l = ext.left[j]!, r = ext.right[j]!;
    const cells = unknowns(vals, range(r, l + len));
    if (cells.length) {
      out.fill.push(...cells);
      out.blocks.push(j);
    }
    out.spans.push({ block: j, from: l, to: l + len, kind: "left" }, { block: j, from: r, to: r + len, kind: "right" });
  }
  return out;
}

/** Block overlap with blocks pushed against crosses and the ends only (filled cells are not used yet). */
function overlap({ clue, vals }: Line): LineFind {
  const crossesOnly = Array.from(vals, (v) => (v === EMPTY ? EMPTY : UNKNOWN));
  const ext = extremes(clue, crossesOnly);
  if (!ext) return none();
  return overlapOf(clue, vals, ext, range(0, vals.length).filter((i) => vals[i] === EMPTY));
}

/** Blocks that could own the run [s, e): those whose reach covers it and that are long enough. */
function owners(clue: Clue, ext: Extremes, s: number, e: number): number[] {
  const out: number[] = [];
  for (let j = 0; j < clue.length; j++) {
    if (clue[j]! >= e - s && ext.left[j]! <= s && ext.right[j]! + clue[j]! >= e) out.push(j);
  }
  return out;
}

/** A run that only blocks of exactly its length can own is complete: both ends are empty. First such run only. */
function capped({ clue, vals }: Line): LineFind {
  const ext = extremes(clue, vals);
  if (!ext) return none();
  for (const [s, e] of runSpans(vals)) {
    const own = owners(clue, ext, s, e);
    if (!own.length || own.some((j) => clue[j] !== e - s)) continue;
    const ends = unknowns(vals, [s - 1, e].filter((i) => i >= 0 && i < vals.length));
    if (ends.length) return { ...none(), empty: ends, sources: range(s, e), blocks: own };
  }
  return none();
}

/** Cells outside every block's reach (given the marks) are empty. */
function reach({ clue, vals }: Line): LineFind {
  const ext = extremes(clue, vals);
  if (!ext) return none();
  const covered = new Uint8Array(vals.length);
  const spans: Span[] = [];
  for (let j = 0; j < clue.length; j++) {
    const from = ext.left[j]!, to = ext.right[j]! + clue[j]!;
    for (let i = from; i < to; i++) covered[i] = 1;
    spans.push({ block: j, from, to, kind: "reach" });
  }
  const empty = unknowns(vals, range(0, vals.length).filter((i) => !covered[i]));
  if (!empty.length) return none();
  const sources = range(0, vals.length).filter((i) => vals[i] !== UNKNOWN);
  return { ...none(), empty, blocks: all(clue.length), spans, sources };
}

/** Overlap again, with each block pushed only as far as the existing marks allow. */
function slide({ clue, vals }: Line): LineFind {
  const ext = extremes(clue, vals);
  if (!ext) return none();
  return overlapOf(clue, vals, ext, range(0, vals.length).filter((i) => vals[i] !== UNKNOWN));
}

/** Complete line logic: what every consistent arrangement agrees on. */
function every({ clue, vals }: Line): LineFind {
  const poss = solveLine(clue, vals);
  if (!poss) return none();
  const fill: number[] = [], empty: number[] = [];
  for (let i = 0; i < vals.length; i++) {
    if (vals[i] !== UNKNOWN) continue;
    if (poss[i] === CAN_FILL) fill.push(i);
    else if (poss[i] === CAN_EMPTY) empty.push(i);
  }
  if (!fill.length && !empty.length) return none();
  const sources = range(0, vals.length).filter((i) => vals[i] !== UNKNOWN);
  return { ...none(), fill, empty, blocks: all(clue.length), sources, ways: countArrangements(clue, vals, 1e6) };
}

/** Easiest first. */
export const LINE_RULES: readonly { id: LineRuleId; find(line: Line): LineFind }[] = [
  { id: "finished", find: finished },
  { id: "exact", find: exact },
  { id: "overlap", find: overlap },
  { id: "capped", find: capped },
  { id: "slide", find: slide },
  { id: "reach", find: reach },
  { id: "every", find: every },
];

/** Cells decided by any rule easier than the one at `idx`. */
function easierCells(idx: number, line: Line): Set<number> {
  const easier = new Set<number>();
  for (let i = 0; i < idx; i++) {
    const f = LINE_RULES[i]!.find(line);
    for (const c of f.fill) easier.add(c);
    for (const c of f.empty) easier.add(c);
  }
  return easier;
}

/**
 * What rule `id` adds on this line beyond every easier rule, or null if nothing. Fill and empty
 * are disjoint from what the easier rules decide, so the result shows exactly this rule at work.
 */
export function ruleOnLine(id: LineRuleId, line: Line): LineFind | null {
  const idx = LINE_RULES.findIndex((r) => r.id === id);
  const own = LINE_RULES[idx]!.find(line);
  if (!own.fill.length && !own.empty.length) return null;
  const easier = easierCells(idx, line);
  const fill = own.fill.filter((c) => !easier.has(c));
  const empty = own.empty.filter((c) => !easier.has(c));
  if (!fill.length && !empty.length) return null;
  // every span stays as context; `blocks` narrows to the blocks whose overlap decided a kept cell
  const keep = new Set([...fill, ...empty]);
  const productive = (j: number) => {
    const l = own.spans.find((s) => s.block === j && s.kind === "left");
    const r = own.spans.find((s) => s.block === j && s.kind === "right");
    return !l || !r || range(r.from, l.to).some((c) => keep.has(c));
  };
  return { ...own, fill, empty, blocks: own.blocks.filter(productive) };
}

/** One instance of a rule on a line: what a single block or run decides, and the positions it covers. */
export interface LineUnit {
  find: LineFind;
  /** Positions [from, to) within the line that belong to the unit. */
  zone: [number, number];
}

/**
 * The parts of `ruleOnLine` that each stand on one block (overlap, slide) or one run (capped);
 * a rule that reasons about the whole line at once gives that one find with the whole line as its zone.
 * A unit decides only blank cells that no easier rule decides.
 */
export function unitsOnLine(id: LineRuleId, line: Line): LineUnit[] {
  const whole = ruleOnLine(id, line);
  if (!whole) return [];
  const n = line.vals.length;
  if (id === "overlap" || id === "slide") {
    const out: LineUnit[] = [];
    for (const j of whole.blocks) {
      const l = whole.spans.find((x) => x.block === j && x.kind === "left");
      const r = whole.spans.find((x) => x.block === j && x.kind === "right");
      if (!l || !r) continue;
      const zone: [number, number] = [r.from, l.to];
      const fill = whole.fill.filter((c) => c >= zone[0] && c < zone[1]);
      if (fill.length) out.push({ zone, find: { ...whole, fill, empty: [], blocks: [j], spans: whole.spans.filter((x) => x.block === j) } });
    }
    return out;
  }
  if (id === "capped") {
    const ext = extremes(line.clue, line.vals);
    if (!ext) return [];
    const easier = easierCells(LINE_RULES.findIndex((r) => r.id === id), line);
    const out: LineUnit[] = [];
    for (const [s, e] of runSpans(line.vals)) {
      const own = owners(line.clue, ext, s, e);
      if (!own.length || own.some((j) => line.clue[j] !== e - s)) continue;
      const ends = unknowns(line.vals, [s - 1, e].filter((i) => i >= 0 && i < n)).filter((c) => !easier.has(c));
      if (ends.length) out.push({ zone: [Math.max(0, s - 1), Math.min(n, e + 1)], find: { ...none(), empty: ends, sources: range(s, e), blocks: own } });
    }
    return out;
  }
  return [{ find: whole, zone: [0, n] }];
}

export { EMPTY, FILLED, UNKNOWN };
