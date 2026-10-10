import type { Rng } from "../../core/rng";
import { defineSchema, type Values } from "../../core/schema";
import type { Format, GenerateContext, Hint, PuzzleDef } from "../../core/types";
import {
  analyzeModel, decidedBy, decides, saturate, solveLevel, trialRule,
  type Analysis, type Constraint, type Doms, type Model, type Rule,
} from "../../lib/grid-kit/csp";
import { cutVertices, neighbours, pieces } from "../../lib/grid-kit/grid";
import { cellList, type Focus } from "../../lib/grid-kit/names";
import { decodeNumber16, encodeNumber16 } from "../../lib/pzpr";
import {
  ANY, B, BLACK, DOT, NONE, W, describeShade, initShade, readShade, reduceShade, solvedShade, wrongShadeHint,
  type ShadeAction, type ShadeInteraction, type ShadeState,
} from "../../lib/shade-kit/state";

export interface NurikabePuzzle {
  w: number;
  h: number;
  /** Row-major: 0 for an empty cell, else the size of the island that number sits in. */
  nums: number[];
}

export const LEVEL_NAMES = ["easy", "normal", "hard"] as const;
export type Level = 0 | 1 | 2;

export const params = defineSchema({
  width: { type: "int", label: "width", default: 8, min: 4, max: 16 },
  height: { type: "int", label: "height", default: 8, min: 4, max: 16 },
  difficulty: {
    type: "enum", label: "difficulty", default: "normal",
    options: [
      { value: "easy", label: "easy", description: "finished islands, cells between two numbers, pools, dead ends, and cells no number can reach" },
      { value: "normal", label: "normal", description: "also cells the sea needs to stay in one piece" },
      { value: "hard", label: "hard", description: "also trying a cell both ways" },
    ],
  },
});

// --- geometry ---

export interface Geometry {
  w: number;
  h: number;
  n: number;
  nbrs: number[][];
  /** Every 2×2 block as its four cells. */
  blocks: number[][];
  clues: number[];
}

const geoCache = new WeakMap<NurikabePuzzle, Geometry>();

export function geometry(p: NurikabePuzzle): Geometry {
  const hit = geoCache.get(p);
  if (hit) return hit;
  const { w, h } = p;
  const blocks: number[][] = [];
  for (let y = 0; y + 1 < h; y++) for (let x = 0; x + 1 < w; x++) {
    const c = y * w + x;
    blocks.push([c, c + 1, c + w, c + w + 1]);
  }
  const g = { w, h, n: w * h, nbrs: neighbours(w, h), blocks, clues: p.nums.flatMap((v, c) => (v > 0 ? [c] : [])) };
  geoCache.set(p, g);
  return g;
}

// --- model ---

/** Connected unshaded cells: per cell its island (-1 when not decided unshaded), and per island its cells and numbers. */
function islands(g: Geometry, p: NurikabePuzzle, k: Doms) {
  const pc = pieces(g.nbrs, (c) => k[c] === W);
  const cells: number[][] = Array.from({ length: pc.count }, () => []);
  for (let c = 0; c < g.n; c++) if (pc.id[c]! >= 0) cells[pc.id[c]!]!.push(c);
  const numbers = cells.map((cs) => cs.filter((c) => p.nums[c]! > 0));
  return { id: pc.id, cells, numbers };
}

const modelCache = new WeakMap<NurikabePuzzle, Model>();

export function model(p: NurikabePuzzle): Model {
  const hit = modelCache.get(p);
  if (hit) return hit;
  const g = geometry(p);
  const constraints: Constraint[] = g.blocks.map((block) => ({
    vars: block,
    run(k, emit) {
      const black = block.filter((c) => k[c] === B), open = block.filter((c) => k[c] === ANY);
      if (black.length === 4) return false;
      if (black.length === 3 && open.length === 1) emit({ kind: "pool", level: 0, vars: open, keep: W, because: black });
      return true;
    },
  }));

  /** Finished islands, cells between two numbers, islands and sea pieces with one way out, unreachable cells. */
  const islandRule: Rule = {
    level: 0,
    kinds: ["island-full", "join-two", "island-grow", "sea-grow", "unreachable"],
    run(live, emit) {
      const k = live.slice();
      const is = islands(g, p, k);
      // numbered islands a cell touches
      const touching = (c: number) => [...new Set(g.nbrs[c]!.map((d) => is.id[d]!).filter((i) => i >= 0 && is.numbers[i]!.length > 0))];
      for (let i = 0; i < is.cells.length; i++) {
        const cells = is.cells[i]!, nums = is.numbers[i]!;
        if (nums.length > 1) return false;
        const exits = [...new Set(cells.flatMap((c) => g.nbrs[c]!.filter((d) => k[d] === ANY)))];
        if (nums.length === 1) {
          const want = p.nums[nums[0]!]!;
          if (cells.length > want) return false;
          if (cells.length === want) {
            if (exits.length && emit({ kind: "island-full", level: 0, vars: exits, keep: B, because: [nums[0]!], related: cells })) return true;
            continue;
          }
        }
        const ways = nums.length ? exits.filter((d) => touching(d).every((j) => j === i)) : exits;
        if (!ways.length) return false;
        if (ways.length === 1 && emit({ kind: "island-grow", level: 0, vars: ways, keep: W, because: nums.length ? nums : cells })) return true;
      }
      for (let c = 0; c < g.n; c++) {
        if (k[c] !== ANY) continue;
        const t = touching(c);
        if (t.length > 1 && emit({ kind: "join-two", level: 0, vars: [c], keep: B, because: t.map((i) => is.numbers[i]![0]!) })) return true;
      }
      const sea = pieces(g.nbrs, (c) => k[c] === B);
      if (sea.count > 1) {
        const size = Array.from({ length: sea.count }, () => 0);
        for (let c = 0; c < g.n; c++) if (sea.id[c]! >= 0) size[sea.id[c]!]!++;
        for (let s = 0; s < sea.count; s++) {
          const exits = [...new Set(Array.from({ length: g.n }, (_, c) => c).filter((c) => sea.id[c] === s).flatMap((c) => g.nbrs[c]!.filter((d) => k[d] === ANY)))];
          if (!exits.length) return false;
          if (exits.length === 1 && emit({ kind: "sea-grow", level: 0, vars: exits, keep: B, because: Array.from({ length: g.n }, (_, c) => c).filter((c) => sea.id[c] === s) })) return true;
        }
      }
      // cells some numbered island could still take: within its remaining size, never next to another numbered island
      const reach = new Uint8Array(g.n);
      for (let i = 0; i < is.cells.length; i++) {
        if (is.numbers[i]!.length !== 1) continue;
        const left = p.nums[is.numbers[i]![0]!]! - is.cells[i]!.length;
        let frontier = is.cells[i]!.slice();
        for (const c of frontier) reach[c] = 1;
        const seen = new Set(frontier);
        for (let step = 0; step < left && frontier.length; step++) {
          const next: number[] = [];
          for (const c of frontier) for (const d of g.nbrs[c]!) {
            const other = is.id[d]! >= 0 && is.id[d] !== i && is.numbers[is.id[d]!]!.length > 0;
            if (seen.has(d) || k[d] === B || other || touching(d).some((j) => j !== i)) continue;
            seen.add(d);
            reach[d] = 1;
            next.push(d);
          }
          frontier = next;
        }
      }
      for (let i = 0; i < is.cells.length; i++) if (!is.numbers[i]!.length && is.cells[i]!.some((c) => !reach[c])) return false;
      const far = Array.from({ length: g.n }, (_, c) => c).filter((c) => k[c] === ANY && !reach[c]);
      if (far.length && emit({ kind: "unreachable", level: 0, vars: far, keep: B, because: g.clues })) return true;
      return true;
    },
  };

  /** A cell that, left unshaded, would cut the sea in two. */
  const seaSplit: Rule = {
    level: 1,
    kinds: ["sea-split"],
    run(live, emit) {
      const k = live.slice();
      const open = (c: number) => k[c] !== W;
      const seaPieces = (except: number) => {
        const pc = pieces(g.nbrs, (c) => c !== except && open(c));
        return new Set(Array.from({ length: g.n }, (_, c) => c).filter((c) => k[c] === B && c !== except).map((c) => pc.id[c]!)).size;
      };
      if (seaPieces(-1) > 1) return false;
      const cut = cutVertices(g.nbrs, open);
      for (let c = 0; c < g.n; c++) {
        if (!cut[c] || k[c] !== ANY) continue;
        if (seaPieces(c) > 1 && emit({ kind: "sea-split", level: 1, vars: [c], keep: B, because: [] })) return true;
      }
      return true;
    },
  };

  const m: Model = {
    n: g.n,
    constraints,
    rules: [islandRule, seaSplit],
    countLevel: 1,
    complete: (k) => isDone(p, g, (c) => k[c] === B),
  };
  m.rules.push(trialRule(m, 2, 1));
  modelCache.set(p, m);
  return m;
}

/** True if the given shading (everything else unshaded) obeys every rule. */
function isDone(p: NurikabePuzzle, g: Geometry, black: (c: number) => boolean): boolean {
  if (g.clues.some(black)) return false;
  if (g.blocks.some((b) => b.every(black))) return false;
  if (pieces(g.nbrs, black).count > 1) return false;
  const white = pieces(g.nbrs, (c) => !black(c));
  const size = Array.from({ length: white.count }, () => 0), num = Array.from({ length: white.count }, () => 0), count = Array.from({ length: white.count }, () => 0);
  for (let c = 0; c < g.n; c++) {
    const i = white.id[c]!;
    if (i < 0) continue;
    size[i]!++;
    if (p.nums[c]! > 0) {
      num[i] = p.nums[c]!;
      count[i]!++;
    }
  }
  return size.every((s, i) => count[i] === 1 && num[i] === s);
}

export const initialDoms = (p: NurikabePuzzle): Doms => Int32Array.from(p.nums, (v) => (v > 0 ? W : ANY));

const analyses = new WeakMap<NurikabePuzzle, Analysis>();

/** Unique-solution analysis, memoized per puzzle. `solution` holds WHITE / SHADED per cell. */
export function analyze(p: NurikabePuzzle): Analysis {
  let a = analyses.get(p);
  if (!a) analyses.set(p, a = analyzeModel(model(p), initialDoms(p), 2));
  return a;
}

const numbered = (p: NurikabePuzzle) => (c: number) => p.nums[c]! > 0;
export const readMarks = (p: NurikabePuzzle, s: ShadeState): Doms => readShade(initialDoms(p), analyze(p), s, numbered(p));

// --- rules check ---

export interface NurikabeConflicts extends Record<string, number[]> {
  /** Shaded cells filling a 2×2 block. */
  pools: number[];
  /** Shaded cells cut off from the rest of the sea by unshaded ones. */
  sea: number[];
  /** Unshaded cells in an island with two numbers, more cells than its number, or no way to reach one. */
  islands: number[];
  /** Numbers whose island can't grow to their size any more. */
  clues: number[];
}

export function findConflicts(p: NurikabePuzzle, marks: readonly number[]): NurikabeConflicts {
  const g = geometry(p);
  const black = (c: number) => marks[c] === BLACK;
  const white = (c: number) => p.nums[c]! > 0 || marks[c] === DOT;
  const pools = [...new Set(g.blocks.filter((b) => b.every(black)).flat())];
  const sea: number[] = [];
  const room = pieces(g.nbrs, (c) => !white(c));
  const seaPieces = [...new Set(Array.from({ length: g.n }, (_, c) => c).filter(black).map((c) => room.id[c]!))];
  if (seaPieces.length > 1) {
    const size = (id: number) => Array.from({ length: g.n }, (_, c) => c).filter((c) => black(c) && room.id[c] === id).length;
    const main = seaPieces.reduce((a, b) => (size(b) > size(a) ? b : a));
    for (let c = 0; c < g.n; c++) if (black(c) && room.id[c] !== main) sea.push(c);
  }
  const isl = pieces(g.nbrs, white);
  const open = pieces(g.nbrs, (c) => !black(c));
  const islands: number[] = [];
  for (let i = 0; i < isl.count; i++) {
    const cells = Array.from({ length: g.n }, (_, c) => c).filter((c) => isl.id[c] === i);
    const nums = cells.filter((c) => p.nums[c]! > 0);
    const shut = cells.every((c) => g.nbrs[c]!.every((d) => isl.id[d] === i || black(d)));
    if (nums.length > 1 || (nums.length === 1 && cells.length > p.nums[nums[0]!]!) || (!nums.length && shut)) islands.push(...cells);
  }
  const clues = g.clues.filter((q) => Array.from({ length: g.n }, (_, c) => c).filter((c) => open.id[c] === open.id[q]).length < p.nums[q]!);
  return { pools, sea, islands, clues };
}

export const isSolved = (p: NurikabePuzzle, s: ShadeState): boolean => isDone(p, geometry(p), (c) => s.marks[c] === BLACK);

// --- formats ---

function checked(w: number, h: number, nums: number[]): NurikabePuzzle {
  if (nums.some((v) => v > w * h)) throw new Error("a number is larger than the grid");
  return { w, h, nums };
}

const URL_RE = /(?:^|[?/])nurikabe\/(\d+)\/(\d+)\/([0-9a-z.+-]*)\/?$/;

/** puzz.link / pzv.jp URLs: `…?nurikabe/W/H/<numbers>`. Unknown numbers (`.`) aren't supported. */
export const pzprFormat: Format<NurikabePuzzle> = {
  id: "pzpr",
  label: "puzz.link URL",
  detect: (t) => URL_RE.test(t.trim()),
  parse(t) {
    const m = URL_RE.exec(t.trim());
    if (!m) throw new Error("expected a puzz.link nurikabe URL, e.g. https://puzz.link/p?nurikabe/6/6/…");
    const w = Number(m[1]), h = Number(m[2]);
    if (!(w >= 2 && h >= 2 && w <= 40 && h <= 40)) throw new Error("size must be between 2×2 and 40×40");
    const { values } = decodeNumber16(m[3]!, w * h);
    if (values.includes(-2)) throw new Error("numbers shown as ? aren't supported");
    if (values.includes(0)) throw new Error("a number must be at least 1");
    return checked(w, h, values.map((v) => (v < 0 ? 0 : v)));
  },
  serialize: (p) => `https://puzz.link/p?nurikabe/${p.w}/${p.h}/${encodeNumber16(p.nums.map((v) => (v > 0 ? v : -1)))}`,
};

/** One row per line: `.` for an empty cell, else its number; tokens separated by spaces when any number has two digits. */
export const textFormat: Format<NurikabePuzzle> = {
  id: "text",
  label: "numbers and dots, one row per line",
  detect: (t) => /^[\d. ]+(\n[\d. ]+)+$/.test(t.trim()),
  parse(t) {
    const rows = t.trim().split(/\r?\n/).map((r) => r.trim()).map((r) => (/\s/.test(r) ? r.split(/\s+/) : [...r]));
    const w = rows[0]!.length, h = rows.length;
    if (rows.some((r) => r.length !== w)) throw new Error("every row needs the same number of cells");
    const nums = rows.flat().map((tok) => {
      if (tok === ".") return 0;
      const v = Number(tok);
      if (!Number.isInteger(v) || v < 1) throw new Error(`"${tok}" isn't a number of at least 1`);
      return v;
    });
    return checked(w, h, nums);
  },
  serialize(p) {
    const wide = p.nums.some((v) => v > 9);
    const rows: string[] = [];
    for (let y = 0; y < p.h; y++) {
      const toks = p.nums.slice(y * p.w, (y + 1) * p.w).map((v) => (v > 0 ? String(v) : "."));
      rows.push(toks.join(wide ? " " : ""));
    }
    return rows.join("\n");
  },
};

// --- hints ---

export const wrongMarksHint = (p: NurikabePuzzle, s: ShadeState): Hint<ShadeAction> | null => wrongShadeHint(p, analyze(p), s);

export function hint(p: NurikabePuzzle, s: ShadeState): Hint<ShadeAction> | null {
  const c = findConflicts(p, s.marks);
  if (c.pools.length) return { message: `the shaded cells on ${cellList(p, c.pools)} fill a 2×2 block`, focus: { cells: c.pools, because: [] } satisfies Focus };
  if (c.islands.length) return { message: `the island on ${cellList(p, c.islands)} breaks a rule`, focus: { cells: c.islands, because: [] } satisfies Focus };
  if (c.clues.length) return { message: `the number on ${cellList(p, c.clues)} can't get an island of its size any more`, focus: { cells: [], because: c.clues } satisfies Focus };
  if (c.sea.length) return { message: `${cellList(p, c.sea)} ${c.sea.length === 1 ? "is" : "are"} cut off from the rest of the sea`, focus: { cells: c.sea, because: [] } satisfies Focus };
  const a = analyze(p);
  if (a.count === 0) return { message: "this puzzle has no solution" };
  if (a.count === 2) return { message: "this puzzle has more than one solution, so it can need a guess" };
  return { message: "none of the techniques you have hints on applies here" };
}

function rate(p: NurikabePuzzle): { label: string; score: number } {
  const a = analyze(p);
  if (a.count === 0) return { label: "no solution", score: -1 };
  if (a.count === 2) return { label: "multiple solutions", score: 10 };
  if (a.level === null) return { label: "needs guessing", score: 3 };
  return { label: LEVEL_NAMES[a.level]!, score: a.level };
}

// --- generation ---

/** A planted solution: shaded cells, plus the cell holding each island's number. */
interface Plant {
  black: Uint8Array;
  numberAt: number[];
}

/** Island id per unshaded cell (-1 for shaded) and the island count. */
const islandsOf = (g: Geometry, black: Uint8Array) => pieces(g.nbrs, (c) => !black[c]);

/** The puzzle a plant describes: each number cell carries its island's size. */
function puzzleOf(g: Geometry, plant: Plant): NurikabePuzzle {
  const isl = islandsOf(g, plant.black);
  const size = Array.from({ length: isl.count }, () => 0);
  for (let c = 0; c < g.n; c++) if (isl.id[c]! >= 0) size[isl.id[c]!]!++;
  const nums = Array.from({ length: g.n }, () => 0);
  for (const c of plant.numberAt) nums[c] = size[isl.id[c]!]!;
  return { w: g.w, h: g.h, nums };
}

/** Unshading `c` keeps the sea in one piece and joins at most one island. */
function canUnshade(g: Geometry, black: Uint8Array, isl: Int32Array, c: number, most: number, size: (i: number) => number): boolean {
  if (!black[c]) return false;
  const near = [...new Set(g.nbrs[c]!.map((d) => isl[d]!).filter((i) => i >= 0))];
  if (near.length > 1 || (near.length === 1 && size(near[0]!) >= most)) return false;
  black[c] = 0;
  const ok = pieces(g.nbrs, (d) => black[d] === 1).count <= 1;
  black[c] = 1;
  return ok;
}

/**
 * Islands grown into an all-shaded grid. About one seed per `spread` cells, then cells are
 * unshaded one at a time: a cell of a remaining 2×2 shaded block when there is one, else a cell
 * next to an island, until about `share` of the grid is unshaded. Each step keeps the sea in one
 * piece, never joins two islands, and keeps islands at most `most` cells; growing an island is
 * preferred to starting one. Null when a pool can't be broken.
 */
function plantSolution(g: Geometry, rng: Rng, share: number, most: number, spread: number): Plant | null {
  const black = new Uint8Array(g.n).fill(1);
  const all = Array.from({ length: g.n }, (_, c) => c);
  const step = (cells: readonly number[]): boolean => {
    const isl = islandsOf(g, black);
    const size = (i: number) => isl.id.reduce((acc, x) => acc + +(x === i), 0);
    const ok = cells.filter((c) => canUnshade(g, black, isl.id, c, most, size));
    if (!ok.length) return false;
    const grow = ok.filter((c) => g.nbrs[c]!.some((d) => !black[d]));
    black[rng.pick(grow.length ? grow : ok)] = 0;
    return true;
  };
  for (let seeds = Math.max(1, Math.round(g.n / spread)); seeds > 0; seeds--) {
    const lone = all.filter((c) => black[c] && g.nbrs[c]!.every((d) => black[d]));
    if (!lone.length || !step([rng.pick(lone)])) break;
  }
  let white = all.filter((c) => !black[c]).length;
  for (let guard = 0; guard < 4 * g.n; guard++) {
    const pool = g.blocks.find((bl) => bl.every((c) => black[c]));
    if (pool) {
      const around = [...new Set(pool.flatMap((c) => [c, ...g.nbrs[c]!]))].filter((c) => black[c]);
      if (!step(around) && !step(pool)) return null;
    } else {
      if (white >= share * g.n) break;
      if (!step(all.filter((c) => black[c] && g.nbrs[c]!.some((d) => !black[d])))) break;
    }
    white++;
  }
  if (g.blocks.some((bl) => bl.every((c) => black[c]))) return null;
  const isl = islandsOf(g, black);
  const members: number[][] = Array.from({ length: isl.count }, () => []);
  for (let c = 0; c < g.n; c++) if (isl.id[c]! >= 0) members[isl.id[c]!]!.push(c);
  return { black, numberAt: members.map((cs) => rng.pick(cs)) };
}

/**
 * Plants one cell away from `plant`: a number moved inside its island, or one cell shaded or
 * unshaded (shading may split an island; each new piece gets a number). Null when the change
 * breaks a rule.
 */
function mutate(g: Geometry, plant: Plant, c: number, most: number, rng: Rng): Plant | null {
  const black = plant.black.slice();
  const isl = islandsOf(g, black);
  const numberAt = plant.numberAt.slice();
  if (black[c]) {
    const size = (i: number) => isl.id.reduce((a, x) => a + +(x === i), 0);
    if (!canUnshade(g, black, isl.id, c, most, size)) return null;
    black[c] = 0;
    if (!g.nbrs[c]!.some((d) => !black[d])) numberAt.push(c);
    return { black, numberAt };
  }
  const own = numberAt.indexOf(c);
  const mates = Array.from({ length: g.n }, (_, d) => d).filter((d) => d !== c && isl.id[d] === isl.id[c]);
  if (own >= 0) {
    if (!mates.length) return null;
    numberAt[own] = rng.pick(mates);
    return { black, numberAt };
  }
  if (rng.bool(0.5)) {
    const holder = numberAt.findIndex((d) => isl.id[d] === isl.id[c]);
    numberAt[holder] = c;
    return { black, numberAt };
  }
  black[c] = 1;
  if (g.blocks.some((b) => b.includes(c) && b.every((d) => black[d]))) return null;
  if (pieces(g.nbrs, (d) => black[d] === 1).count > 1) return null;
  // a split island: every new piece without a number gets one
  const parts = pieces(g.nbrs, (d) => isl.id[d] === isl.id[c] && !black[d]);
  for (let i = 0; i < parts.count; i++) {
    const cells = Array.from({ length: g.n }, (_, d) => d).filter((d) => parts.id[d] === i);
    if (!cells.some((d) => numberAt.includes(d))) numberAt.push(rng.pick(cells));
  }
  return { black, numberAt };
}

const EXACT_ATTEMPTS = 30;
const MAX_ATTEMPTS = 150;
const SAMPLE = 10;
const PLANT_TRIES = 20;

/**
 * Reshapes the plant until logic at `level` finishes its puzzle and logic one level easier
 * doesn't. Each step scores a sample of one-cell changes near where cheap logic gets stuck by how
 * much it decides, and keeps the best, sideways included; the target is checked whenever the
 * score reaches a new best (and on every step at a full score). Null if the budget runs out.
 */
async function settle(g: Geometry, start: Plant, level: Level, most: number, rng: Rng, ctx: GenerateContext): Promise<NurikabePuzzle | null> {
  const cheap = Math.min(level, 1);
  const score = (q: NurikabePuzzle) => decidedBy(model(q), initialDoms(q), cheap);
  const easier = (q: NurikabePuzzle) => level > 0 && decides(model(q), initialDoms(q), level - 1);
  const done = (q: NurikabePuzzle, got: number) =>
    (level < 2 ? got === g.n : got >= g.n / 2 && decides(model(q), initialDoms(q), level)) && !easier(q);
  let plant = start, p = puzzleOf(g, plant), now = score(p), top = now;
  if (done(p, now)) return p;
  for (let step = 0; step < 4 * g.n; step++) {
    await ctx.yield();
    const k = initialDoms(p);
    saturate(model(p), k, cheap);
    const stuck = Array.from({ length: g.n }, (_, c) => c).filter((c) => k[c] === ANY);
    const near = stuck.length ? [...new Set(stuck.flatMap((c) => [c, ...g.nbrs[c]!]))] : Array.from({ length: g.n }, (_, c) => c);
    let best: { plant: Plant; p: NurikabePuzzle; score: number } | null = null;
    for (let t = 0; t < SAMPLE && near.length; t++) {
      const next = mutate(g, plant, rng.pick(near), most, rng);
      if (!next) continue;
      const q = puzzleOf(g, next);
      const s = score(q);
      if (!best || s > best.score) best = { plant: next, p: q, score: s };
    }
    if (!best || best.score < now) continue;
    ({ plant, p, score: now } = best);
    // at the top score, sideways steps can still make the puzzle need the level rather than an easier one
    if (now > top || (level < 2 && now === g.n)) {
      top = now;
      if (done(p, now)) return p;
    }
  }
  return null;
}

/**
 * Deterministic in (params, rng): a planted solution, then one-cell changes until logic at the
 * level finishes it. Needs exactly the level when one turns up within EXACT_ATTEMPTS plants,
 * else the hardest found.
 */
export async function generatePuzzle(w: number, h: number, level: Level, rng: Rng, ctx: GenerateContext): Promise<NurikabePuzzle> {
  const g = geometry({ w, h, nums: [] });
  const most = Math.max(4, Math.round((w + h) / 2));
  let best: { p: NurikabePuzzle; level: number } | null = null;
  for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
    if (best && attempt >= EXACT_ATTEMPTS) break;
    await ctx.yield();
    const r = rng.fork(`attempt ${attempt}`);
    let plant: Plant | null = null;
    for (let t = 0; t < PLANT_TRIES && !plant; t++) plant = plantSolution(g, r.fork(`plant ${t}`), 0.45, most, 7);
    if (!plant) continue;
    const p = await settle(g, plant, level, most, r, ctx);
    if (!p) continue;
    const got = solveLevel(model(p), initialDoms(p), level)!;
    if (got === level) return p;
    if (!best || got > best.level) best = { p, level: got };
  }
  if (best) return best.p;
  throw new Error("couldn't make a puzzle with these settings; try a different size");
}

export const nurikabe: PuzzleDef<NurikabePuzzle, ShadeState, ShadeAction, ShadeInteraction, typeof params> = {
  id: "nurikabe",
  name: "nurikabe",
  aliases: ["islands in the stream"],
  tags: ["logic", "grid", "numbers", "shading", "nikoli"],
  description: "shade cells to make one connected sea around islands of unshaded cells. every island holds exactly one number, which is its size, and the sea never fills a 2×2 block.",
  generatorVersion: 1,
  params,
  presets: [
    { label: "7×7 easy", params: { width: 7, height: 7, difficulty: "easy" } },
    { label: "8×8 normal", params: { width: 8, height: 8, difficulty: "normal" } },
    { label: "10×10 normal", params: { width: 10, height: 10, difficulty: "normal" } },
    { label: "10×10 hard", params: { width: 10, height: 10, difficulty: "hard" } },
  ],
  generate: (v: Values<typeof params>, rng, ctx) => generatePuzzle(v.width, v.height, LEVEL_NAMES.indexOf(v.difficulty as (typeof LEVEL_NAMES)[number]) as Level, rng, ctx),
  formats: [pzprFormat, textFormat],
  init: (p) => initShade(p.w * p.h),
  initInteraction: () => ({ cursor: 0 }),
  reduce: (p, s, a) => reduceShade(p.w * p.h, numbered(p), s, a),
  isRetraction: (a) => a.value === NONE,
  rules: () => [
    "shade some cells to make the sea. numbered cells are never shaded.",
    "the unshaded cells form islands (groups touching side by side). every island holds exactly one number, and that number is how many cells the island has.",
    "all the shaded cells must form one connected sea.",
    "the sea may never fill a 2×2 block.",
    "a dot is your own note that a cell stays unshaded. it doesn't count for anything.",
  ],
  isSolved,
  solve(p) {
    const a = analyze(p);
    return a.solution ? { board: solvedShade(a.solution, numbered(p)) } : null;
  },
  hint,
  rate,
  describeAction: (p, a, before, after) => describeShade(p, a, before, after),
  describe: (p) => `${p.w}×${p.h}`,
};
