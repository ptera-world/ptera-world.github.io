import type { Rng } from "../../core/rng";
import { defineSchema, type Values } from "../../core/schema";
import type { Format, GenerateContext, Hint, PuzzleDef } from "../../core/types";
import {
  analyzeModel, bit, decides, levelNeeded, trialRule,
  type Analysis, type Constraint, type Doms, type Model, type Rule,
} from "../../lib/grid-kit/csp";
import { cellList, cellName, type Focus } from "../../lib/grid-kit/names";
import { listOf } from "../../lib/edge-names";

export interface PalisadePuzzle {
  w: number;
  h: number;
  /** Region size. */
  k: number;
  /** Row-major: -1 no number, else how many of the cell's four sides are walls (the grid edge counts). */
  clues: number[];
}

/** Model values per inner edge. */
export const OPEN = 0, WALL = 1;
const O = bit(OPEN), Wl = bit(WALL), ANY = O | Wl;

/** Per-edge mark. GAP is the player's "no wall here" note. */
export const NONE = 0, LINE = 1, GAP = 2;
export type Mark = typeof NONE | typeof LINE | typeof GAP;

export interface PalisadeState {
  /** Per inner edge (see Geometry.edges). */
  marks: number[];
}

/** Setting NONE is the only way marks are removed, so it alone is a retraction. */
export type PalisadeAction = { type: "set"; edges: number[]; value: Mark };

export interface PalisadeInteraction {
  cursor: number;
}

export const LEVEL_NAMES = ["normal", "hard"] as const;
export type Level = 0 | 1;

export const params = defineSchema({
  width: { type: "int", label: "width", default: 5, min: 2, max: 16 },
  height: { type: "int", label: "height", default: 5, min: 2, max: 16 },
  size: { type: "int", label: "region size", default: 5, min: 2, max: 20 },
  difficulty: {
    type: "enum", label: "difficulty", default: "normal",
    options: [
      { value: "normal", label: "normal", description: "numbers, wall ends, and how big regions can grow" },
      { value: "hard", label: "hard", description: "also trying an edge both ways" },
    ],
  },
});

// --- geometry ---

export interface Geometry {
  w: number;
  h: number;
  n: number;
  /** Inner edges as the two cells they separate: first all left-right pairs by row, then all up-down pairs. */
  edges: [number, number][];
  /** Per cell: its inner edges and the neighbor across each. */
  sides: { edge: number; other: number }[][];
  /** Per inner grid point (corner not on the rim): its four edges. */
  corners: number[][];
  shown: number[];
}

const geoCache = new WeakMap<PalisadePuzzle, Geometry>();

export function geometry(p: PalisadePuzzle): Geometry {
  const hit = geoCache.get(p);
  if (hit) return hit;
  const { w, h } = p;
  const edges: [number, number][] = [];
  const hIndex = (x: number, y: number) => y * (w - 1) + x;
  const vIndex = (x: number, y: number) => (w - 1) * h + y * w + x;
  for (let y = 0; y < h; y++) for (let x = 0; x + 1 < w; x++) edges.push([y * w + x, y * w + x + 1]);
  for (let y = 0; y + 1 < h; y++) for (let x = 0; x < w; x++) edges.push([y * w + x, (y + 1) * w + x]);
  const sides = Array.from({ length: w * h }, () => [] as { edge: number; other: number }[]);
  edges.forEach(([a, b], e) => {
    sides[a]!.push({ edge: e, other: b });
    sides[b]!.push({ edge: e, other: a });
  });
  const corners: number[][] = [];
  for (let y = 1; y < h; y++) {
    for (let x = 1; x < w; x++) {
      // the four edges meeting at the corner below-right of cell (x-1, y-1)
      corners.push([vIndex(x - 1, y - 1), vIndex(x, y - 1), hIndex(x - 1, y - 1), hIndex(x - 1, y)]);
    }
  }
  const g = { w, h, n: w * h, edges, sides, corners, shown: p.clues.flatMap((v, i) => (v >= 0 ? [i] : [])) };
  geoCache.set(p, g);
  return g;
}

/** Sides of cell c on the grid's rim (always walls). */
export const rimSides = (g: Geometry, c: number): number => 4 - g.sides[c]!.length;

/** Regions joined through open edges: per cell its region id, plus each region's size. */
export function regions(g: Geometry, open: (e: number) => boolean): { id: Int32Array; size: number[] } {
  const id = new Int32Array(g.n).fill(-1);
  const size: number[] = [];
  for (let s = 0; s < g.n; s++) {
    if (id[s] !== -1) continue;
    const r = size.length;
    let count = 0;
    const stack = [s];
    id[s] = r;
    while (stack.length) {
      const c = stack.pop()!;
      count++;
      for (const { edge, other } of g.sides[c]!) {
        if (id[other] === -1 && open(edge)) {
          id[other] = r;
          stack.push(other);
        }
      }
    }
    size.push(count);
  }
  return { id, size };
}

// --- model ---

const modelCache = new WeakMap<PalisadePuzzle, Model>();

export function model(p: PalisadePuzzle): Model {
  const hit = modelCache.get(p);
  if (hit) return hit;
  const g = geometry(p);
  const constraints: Constraint[] = [];
  for (const c of g.shown) {
    const sides = g.sides[c]!, n = p.clues[c]!, rim = rimSides(g, c);
    constraints.push({
      vars: sides.map((s) => s.edge),
      run(k, emit) {
        const walls = rim + sides.filter((s) => k[s.edge] === Wl).length;
        const open = sides.filter((s) => k[s.edge] === ANY).map((s) => s.edge);
        if (walls > n || walls + open.length < n) return false;
        if (!open.length) return true;
        if (walls === n) emit({ kind: "clue-done", level: 0, vars: open, keep: O, because: [c] });
        else if (walls + open.length === n) emit({ kind: "clue-full", level: 0, vars: open, keep: Wl, because: [c] });
        return true;
      },
    });
  }
  // a wall can't just stop at a corner: never exactly one wall meets there
  g.corners.forEach((edges) => {
    constraints.push({
      vars: edges,
      run(k, emit) {
        const open = edges.filter((e) => k[e] === ANY);
        const walls = edges.filter((e) => k[e] === Wl).length;
        if (!open.length) return walls !== 1;
        // only the last open edge is ever forced: it settles whether exactly one wall meets here
        if (open.length === 1 && walls <= 1) emit({ kind: "dangling", level: 0, vars: open, keep: walls === 1 ? Wl : O, because: [], related: edges.filter((x) => x !== open[0]) });
        return true;
      },
    });
  });
  const grow: Rule = {
    level: 0,
    kinds: ["region-full", "region-merge", "region-joined", "region-exit"],
    run(k, emit) {
      const { id, size } = regions(g, (e) => k[e] === O);
      if (size.some((s) => s > p.k)) return false;
      // per region: the one region it could still join (-1 none yet, -2 several)
      const only = new Int32Array(size.length).fill(-1);
      const note = (r: number, other: number) => {
        if (only[r] === -1) only[r] = other;
        else if (only[r] !== other) only[r] = -2;
      };
      for (let e = 0; e < g.edges.length; e++) {
        if (k[e] !== ANY) continue;
        const [a, b] = g.edges[e]!;
        const ra = id[a]!, rb = id[b]!;
        if (ra === rb) {
          if (emit({ kind: "region-joined", level: 0, vars: [e], keep: O, because: [a, b] })) return true;
          continue;
        }
        if (size[ra]! + size[rb]! > p.k) {
          const full = size[ra] === p.k ? a : size[rb] === p.k ? b : -1;
          if (emit({ kind: full >= 0 ? "region-full" : "region-merge", level: 0, vars: [e], keep: Wl, because: [a, b], data: { sizes: [size[ra], size[rb]] } })) return true;
          continue;
        }
        note(ra, rb);
        note(rb, ra);
      }
      for (let r = 0; r < size.length; r++) {
        if (size[r] === p.k) continue;
        if (only[r] === -1) return false;
        if (only[r]! < 0) continue;
        const edges: number[] = [];
        for (let e = 0; e < g.edges.length; e++) {
          const [a, b] = g.edges[e]!;
          if (k[e] === ANY && ((id[a] === r && id[b] === only[r]) || (id[b] === r && id[a] === only[r]))) edges.push(e);
        }
        if (emit({ kind: "region-exit", level: 0, vars: edges, keep: O, because: [id.indexOf(r)], data: { size: size[r] } })) return true;
      }
      return true;
    },
  };
  const m: Model = {
    n: g.edges.length,
    constraints,
    rules: [grow],
    complete: (k) => regions(g, (e) => k[e] === O).size.every((s) => s === p.k),
    done: (k) => isDoneBy(p, g, (e) => k[e] === Wl),
  };
  m.rules.push(trialRule(m, 1, 0));
  modelCache.set(p, m);
  return m;
}

/** True if the given walls (every other edge open) split the grid into regions of the right size that satisfy every number. */
function isDoneBy(p: PalisadePuzzle, g: Geometry, wall: (e: number) => boolean): boolean {
  const { id, size } = regions(g, (e) => !wall(e));
  if (size.some((s) => s !== p.k)) return false;
  if (g.edges.some(([a, b], e) => wall(e) && id[a] === id[b])) return false;
  return g.shown.every((c) => rimSides(g, c) + g.sides[c]!.filter((s) => wall(s.edge)).length === p.clues[c]);
}

export const initialDoms = (p: PalisadePuzzle): Doms => new Int32Array(geometry(p).edges.length).fill(ANY);

const analyses = new WeakMap<PalisadePuzzle, Analysis>();

/** Unique-solution analysis, memoized per puzzle. `solution` holds OPEN / WALL per inner edge. */
export function analyze(p: PalisadePuzzle): Analysis {
  let a = analyses.get(p);
  if (!a) analyses.set(p, a = analyzeModel(model(p), initialDoms(p), 1));
  return a;
}

/** Board marks as domains; every mark counts. */
export function readMarks(p: PalisadePuzzle, s: PalisadeState): Doms {
  const k = initialDoms(p);
  s.marks.forEach((m, e) => {
    if (m === LINE) k[e] = Wl;
    else if (m === GAP) k[e] = O;
  });
  return k;
}

// --- state ---

export function reduce(p: PalisadePuzzle, s: PalisadeState, a: PalisadeAction): PalisadeState {
  if (a.type !== "set" || ![NONE, LINE, GAP].includes(a.value)) return s;
  let next: number[] | null = null;
  for (const e of a.edges) {
    if (!(e >= 0 && e < s.marks.length) || s.marks[e] === a.value) continue;
    next ??= s.marks.slice();
    next[e] = a.value;
  }
  return next ? { marks: next } : s;
}

export interface PalisadeConflicts extends Record<string, number[]> {
  /** Numbers with too many walls round them, or too few edges left to reach theirs. */
  clues: number[];
  /** Cells of a walled-off region of the wrong size. */
  regions: number[];
}

export function findConflicts(p: PalisadePuzzle, marks: readonly number[]): PalisadeConflicts {
  const g = geometry(p);
  const clues = g.shown.filter((c) => {
    const walls = rimSides(g, c) + g.sides[c]!.filter((s) => marks[s.edge] === LINE).length;
    const open = g.sides[c]!.filter((s) => marks[s.edge] === NONE).length;
    return walls > p.clues[c]! || walls + open < p.clues[c]!;
  });
  // walled off into fewer than k cells, or joined by gaps into more than k
  const walled = regions(g, (e) => marks[e] !== LINE);
  const joined = regions(g, (e) => marks[e] === GAP);
  const bad: number[] = [];
  for (let c = 0; c < g.n; c++) if (walled.size[walled.id[c]!]! < p.k || joined.size[joined.id[c]!]! > p.k) bad.push(c);
  return { clues, regions: bad };
}

export const isSolved = (p: PalisadePuzzle, s: PalisadeState): boolean => isDoneBy(p, geometry(p), (e) => s.marks[e] === LINE);

// --- formats ---

const SGT_RE = /^(\d+)(?:x(\d+))?(?:n(\d+))?:([a-z0-4]*)$/;

function checkPuzzle(w: number, h: number, k: number, clues: number[]): PalisadePuzzle {
  if (!(w >= 1 && h >= 1 && w <= 60 && h <= 60)) throw new Error("size must be between 1×1 and 60×60");
  if (!(k >= 1) || (w * h) % k) throw new Error("the region size must divide the grid's area");
  if (clues.length > w * h) throw new Error("too much data for the grid");
  while (clues.length < w * h) clues.push(-1);
  return { w, h, k, clues };
}

/**
 * Simon Tatham's Palisade game id: `WxHnK:` (K the region size) then a digit 0–4 per numbered cell
 * and `a`–`z` for 1–26 cells without one; cells past the end have none.
 */
export const sgtFormat: Format<PalisadePuzzle> = {
  id: "sgt",
  label: "game id (WxHnK:…)",
  detect: (t) => SGT_RE.test(t.trim()),
  parse(t) {
    const m = SGT_RE.exec(t.trim());
    if (!m) throw new Error("expected WxHnK:desc, e.g. 5x5n5:a2b3…");
    const w = Number(m[1]), h = Number(m[2] ?? m[1]), k = Number(m[3] ?? m[1]);
    const clues: number[] = [];
    for (const ch of m[4]!) {
      if (ch >= "0" && ch <= "4") clues.push(Number(ch));
      else for (let i = 0; i < ch.charCodeAt(0) - 96; i++) clues.push(-1);
    }
    return checkPuzzle(w, h, k, clues);
  },
  serialize(p) {
    let out = "", run = 0;
    for (const v of p.clues) {
      if (v < 0) {
        run++;
        continue;
      }
      while (run > 0) {
        const step = Math.min(run, 26);
        out += String.fromCharCode(96 + step);
        run -= step;
      }
      out += String(v);
    }
    return `${p.w}x${p.h}n${p.k}:${out}`;
  },
};

// --- hints ---

/** Cells on each side of the edges. */
export const edgeCells = (p: PalisadePuzzle, edges: readonly number[]): number[] => [...new Set(edges.flatMap((e) => geometry(p).edges[e]!))];

export function wrongMarksHint(p: PalisadePuzzle, s: PalisadeState): Hint<PalisadeAction> | null {
  const a = analyze(p);
  if (a.count !== 1 || !a.solution) return null;
  const sol = a.solution;
  const wrong = s.marks.flatMap((m, e) => ((m === LINE && sol[e] !== WALL) || (m === GAP && sol[e] !== OPEN) ? [e] : []));
  if (!wrong.length) return null;
  const cells = edgeCells(p, wrong);
  return {
    message: `${wrong.length === 1 ? "the mark between" : "the marks between"} ${cellList(p, cells)} ${wrong.length === 1 ? "is" : "are"} wrong`,
    focus: { cells, because: [] } satisfies Focus,
    actions: [{ type: "set", edges: wrong, value: NONE }],
  };
}

export function hint(p: PalisadePuzzle, s: PalisadeState): Hint<PalisadeAction> | null {
  const c = findConflicts(p, s.marks);
  if (c.clues.length) return { message: `the number on ${cellList(p, c.clues)} can't be met any more`, focus: { cells: [], because: c.clues } satisfies Focus };
  if (c.regions.length) return { message: `${cellList(p, c.regions)} ${c.regions.length === 1 ? "is" : "are"} in a region of the wrong size`, focus: { cells: c.regions, because: [] } satisfies Focus };
  const a = analyze(p);
  if (a.count === 0) return { message: "this puzzle has no solution" };
  if (a.count === 2) return { message: "this puzzle has more than one solution, so it can need a guess" };
  return { message: "none of the techniques you have hints on applies here" };
}

function rate(p: PalisadePuzzle): { label: string; score: number } {
  const a = analyze(p);
  if (a.count === 0) return { label: "no solution", score: -1 };
  if (a.count === 2) return { label: "multiple solutions", score: 10 };
  if (a.level === null) return { label: "needs guessing", score: 2 };
  return { label: LEVEL_NAMES[a.level]!, score: a.level };
}

// --- generation ---

/**
 * A random split of the grid into connected regions of k cells, or null if this try paints itself
 * into a corner. Regions grow one cell at a time from the open cell with the fewest open
 * neighbors; a region is undone if it leaves an open pocket whose size isn't a multiple of k.
 */
export function divide(w: number, h: number, k: number, rng: Rng): Int32Array | null {
  const n = w * h;
  const region = new Int32Array(n).fill(-1);
  const nb = (c: number) => {
    const x = c % w, y = Math.floor(c / w);
    const out: number[] = [];
    if (y > 0) out.push(c - w);
    if (x > 0) out.push(c - 1);
    if (x < w - 1) out.push(c + 1);
    if (y < h - 1) out.push(c + w);
    return out;
  };
  const freeNb = (c: number) => nb(c).filter((d) => region[d] === -1).length;
  const pocketsOk = () => {
    const seen = new Uint8Array(n);
    for (let s = 0; s < n; s++) {
      if (seen[s] || region[s] !== -1) continue;
      let size = 0;
      const stack = [s];
      seen[s] = 1;
      while (stack.length) {
        const c = stack.pop()!;
        size++;
        for (const d of nb(c)) if (!seen[d] && region[d] === -1) {
          seen[d] = 1;
          stack.push(d);
        }
      }
      if (size % k) return false;
    }
    return true;
  };
  for (let r = 0; r < n / k; r++) {
    let placed = false;
    for (let tries = 0; tries < 30 && !placed; tries++) {
      const open = Array.from({ length: n }, (_, c) => c).filter((c) => region[c] === -1);
      const fewest = Math.min(...open.map(freeNb));
      const start = rng.pick(open.filter((c) => freeNb(c) === fewest));
      const cells = [start];
      region[start] = r;
      while (cells.length < k) {
        const frontier = [...new Set(cells.flatMap(nb))].filter((d) => region[d] === -1);
        if (!frontier.length) break;
        const d = rng.pick(frontier);
        region[d] = r;
        cells.push(d);
      }
      if (cells.length === k && pocketsOk()) placed = true;
      else for (const c of cells) region[c] = -1;
    }
    if (!placed) return null;
  }
  return region;
}

/** Removals tried at the costly level once the level below suffices; the split is retried if none works. */
const COSTLY_TRIES = 12;
const EXACT_ATTEMPTS = 40;
const MAX_ATTEMPTS = 400;

/**
 * Deterministic in (params, rng): a random split into regions, every cell numbered, then numbers
 * removed in random order while logic still decides every edge (one level down first, then at the
 * requested level). Needs exactly the level when one turns up within EXACT_ATTEMPTS splits, else
 * the hardest found.
 */
export async function generatePuzzle(w: number, h: number, k: number, level: Level, rng: Rng, ctx: GenerateContext): Promise<PalisadePuzzle> {
  if ((w * h) % k) throw new Error("the region size must divide width × height");
  if (k === w * h) throw new Error("the region size must be smaller than the whole grid");
  if (k === 2 && w > 1 && h > 1) throw new Error("regions of 2 need a grid one cell wide");
  const g = geometry({ w, h, k, clues: [] });
  let best: { p: PalisadePuzzle; level: number } | null = null;
  for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
    if (best && attempt >= EXACT_ATTEMPTS) break;
    await ctx.yield();
    const r = rng.fork(`attempt ${attempt}`);
    const region = divide(w, h, k, r);
    if (!region) continue;
    const clues = Array.from({ length: w * h }, (_, c) => rimSides(g, c) + g.sides[c]!.filter((s) => region[s.other] !== region[c]).length);
    if (!decides(model({ w, h, k, clues }), initialDoms({ w, h, k, clues }), level)) continue;
    const order = r.shuffle(Array.from({ length: w * h }, (_, i) => i));
    const check = (pass: number) => decides(model({ w, h, k, clues: clues.slice() }), initialDoms({ w, h, k, clues }), pass);
    // a cheap pass one level down; then at the costly level, once the cheap level suffices, only
    // until a removal makes the requested level needed
    for (const pass of level > 0 ? [level - 1, level] : [level]) {
      const easier = pass > 0 && check(pass - 1);
      let tries = 0;
      for (const c of order) {
        if (clues[c]! < 0) continue;
        if (pass === level && easier && ++tries > COSTLY_TRIES) break;
        await ctx.yield();
        const keep = clues[c]!;
        clues[c] = -1;
        if (!check(pass)) clues[c] = keep;
        else if (pass === level && easier && !check(pass - 1)) break;
      }
    }
    const p: PalisadePuzzle = { w, h, k, clues };
    const got = levelNeeded(model(p), initialDoms(p), level)!;
    if (got === level) return p;
    if (!best || got > best.level) best = { p, level: got };
  }
  if (best) return best.p;
  throw new Error("couldn't make a puzzle with these settings; try bigger regions, a different size, or hard");
}

export const palisade: PuzzleDef<PalisadePuzzle, PalisadeState, PalisadeAction, PalisadeInteraction, typeof params> = {
  id: "palisade",
  name: "palisade",
  aliases: ["five cells", "nikoli five cells", "divide by squares"],
  tags: ["logic", "grid", "numbers", "regions", "nikoli"],
  description: "draw walls along the grid lines to split the board into regions all the same size. a number says how many of its cell's four sides are walls, the grid's edge included.",
  generatorVersion: 1,
  params,
  presets: [
    { label: "5×5, regions of 5", params: { width: 5, height: 5, size: 5, difficulty: "normal" } },
    { label: "8×6, regions of 6", params: { width: 8, height: 6, size: 6, difficulty: "normal" } },
    { label: "8×6, regions of 6, hard", params: { width: 8, height: 6, size: 6, difficulty: "hard" } },
    { label: "10×8, regions of 8", params: { width: 10, height: 8, size: 8, difficulty: "normal" } },
    { label: "15×12, regions of 10", params: { width: 15, height: 12, size: 10, difficulty: "normal" } },
  ],
  generate: (v: Values<typeof params>, rng, ctx) =>
    generatePuzzle(v.width, v.height, v.size, LEVEL_NAMES.indexOf(v.difficulty as (typeof LEVEL_NAMES)[number]) as Level, rng, ctx),
  formats: [sgtFormat],
  init: (p) => ({ marks: geometry(p).edges.map(() => NONE) }),
  initInteraction: () => ({ cursor: 0 }),
  reduce,
  isRetraction: (a) => a.value === NONE,
  rules: (p) => [
    `draw walls along the grid lines so the board splits into regions of exactly ${p.k} cells each, every region joined side by side.`,
    "a number says how many of its cell's four sides are walls. the edge of the grid counts as a wall.",
    "every wall must separate two different regions: no stray walls inside a region.",
    "a gap mark is your own note that an edge has no wall. it doesn't count for anything.",
  ],
  describeAction: (p, a) => {
    const g = geometry(p);
    return `${a.value === LINE ? "wall" : a.value === GAP ? "gap" : "clear"} ${listOf(a.edges, (e) => `${cellName(p, g.edges[e]![0])}-${cellName(p, g.edges[e]![1])}`)}`;
  },
  isSolved,
  solve(p) {
    const a = analyze(p);
    return a.solution ? { board: { marks: a.solution.map((v) => (v === WALL ? LINE : GAP)) } } : null;
  },
  hint,
  rate,
  describe: (p) => `${p.w}×${p.h}, regions of ${p.k}`,
};
