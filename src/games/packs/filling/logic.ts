import type { Rng } from "../../core/rng";
import { defineSchema, type Values } from "../../core/schema";
import type { Format, GenerateContext, Hint, PuzzleDef } from "../../core/types";
import {
  analyzeModel, bit, decides, isSingle, levelNeeded, trialRule, valueOf, valuesOf,
  type Analysis, type Doms, type Model, type Rule,
} from "../../lib/grid-kit/csp";
import { neighbours } from "../../lib/grid-kit/grid";
import { cellList, type Focus } from "../../lib/grid-kit/names";

export interface FillingPuzzle {
  w: number;
  h: number;
  /** Row-major givens: 0 empty, else the number shown. */
  clues: number[];
}

export interface FillingState {
  /** Per cell, the numbers it can still hold (bit v for v); one bit is a placed number. Givens are never changed. */
  doms: number[];
}

/** "set" replaces masks (player moves); "clear" forgets a cell; "toggle" flips one candidate; "narrow" intersects (technique steps). */
export type FillingAction =
  | { type: "set"; cells: number[]; mask: number }
  | { type: "clear"; cells: number[] }
  | { type: "toggle"; cells: number[]; value: number }
  | { type: "narrow"; cells: number[]; keep: number };

export interface FillingInteraction {
  cursor: number;
  /** Cells a typed number goes into. */
  selection: number[];
  /** Typing toggles small candidate numbers instead of placing. */
  candidates: boolean;
}

export const LEVEL_NAMES = ["easy", "medium", "hard"] as const;
export type Level = 0 | 1 | 2;

export const params = defineSchema({
  width: { type: "int", label: "width", default: 9, min: 2, max: 20 },
  height: { type: "int", label: "height", default: 7, min: 2, max: 20 },
  difficulty: {
    type: "enum", label: "difficulty", default: "easy",
    options: [
      { value: "easy", label: "easy", description: "full regions, room to grow, and regions with one way out" },
      { value: "medium", label: "medium", description: "also cells a region can't grow without" },
      { value: "hard", label: "hard", description: "also trying a number both ways" },
    ],
  },
});

/** Largest number a w×h board can hold (single digits only). */
export const maxNumber = (w: number, h: number): number => Math.min(9, Math.max(w, h, w === 2 && h === 2 ? 3 : 0));
export const fullMask = (n: number): number => ((1 << (n + 1)) - 1) & ~1;

// --- geometry ---

export interface Geometry {
  w: number;
  h: number;
  n: number;
  top: number;
  full: number;
  nbrs: number[][];
}

const geoCache = new WeakMap<FillingPuzzle, Geometry>();

export function geometry(p: FillingPuzzle): Geometry {
  const hit = geoCache.get(p);
  if (hit) return hit;
  const top = maxNumber(p.w, p.h);
  const g = { w: p.w, h: p.h, n: p.w * p.h, top, full: fullMask(top), nbrs: neighbours(p.w, p.h) };
  geoCache.set(p, g);
  return g;
}

/** Groups of joined cells holding the same placed number. */
export interface Group {
  value: number;
  cells: number[];
}

export function groups(g: Geometry, value: (c: number) => number): { id: Int32Array; list: Group[] } {
  const id = new Int32Array(g.n).fill(-1);
  const list: Group[] = [];
  for (let s = 0; s < g.n; s++) {
    const v = value(s);
    if (!v || id[s] !== -1) continue;
    const cells = [s];
    id[s] = list.length;
    for (let i = 0; i < cells.length; i++) {
      for (const d of g.nbrs[cells[i]!]!) {
        if (id[d] === -1 && value(d) === v) {
          id[d] = list.length;
          cells.push(d);
        }
      }
    }
    list.push({ value: v, cells });
  }
  return { id, list };
}

// --- model ---

const modelCache = new WeakMap<FillingPuzzle, Model>();

export function model(p: FillingPuzzle): Model {
  const hit = modelCache.get(p);
  if (hit) return hit;
  const g = geometry(p);
  const placed = (k: Doms) => (c: number) => (isSingle(k[c]!) ? valueOf(k[c]!) : 0);
  /** Cells a region of v grown from `from` could cover, never through `skip`. */
  const reach = (k: Doms, from: readonly number[], v: number, skip = -1): number => {
    const seen = new Uint8Array(g.n);
    const stack = from.slice();
    for (const c of from) seen[c] = 1;
    let count = 0;
    while (stack.length) {
      const c = stack.pop()!;
      count++;
      if (count >= v) return count;
      for (const d of g.nbrs[c]!) {
        if (seen[d] || d === skip || !(k[d]! & bit(v))) continue;
        seen[d] = 1;
        stack.push(d);
      }
    }
    return count;
  };
  const regionsRule: Rule = {
    level: 0,
    kinds: ["complete", "too-big", "no-room", "only-exit"],
    run(live, emit) {
      // every deduction comes from this one snapshot; emits may narrow `live` as they go
      const k = live.slice();
      const { id, list } = groups(g, placed(k));
      for (const grp of list) {
        if (grp.cells.length > grp.value) return false;
        const exits = [...new Set(grp.cells.flatMap((c) => g.nbrs[c]!))].filter((d) => id[d] !== id[grp.cells[0]!] && !isSingle(k[d]!) && k[d]! & bit(grp.value));
        if (grp.cells.length === grp.value) {
          if (exits.length && emit({ kind: "complete", level: 0, vars: exits, keep: g.full & ~bit(grp.value), because: grp.cells, data: { value: grp.value } })) return true;
          continue;
        }
        if (!exits.length || reach(k, grp.cells, grp.value) < grp.value) return false;
        if (exits.length === 1 && emit({ kind: "only-exit", level: 0, vars: exits, keep: bit(grp.value), because: grp.cells, data: { value: grp.value } })) return true;
      }
      for (let c = 0; c < g.n; c++) {
        if (isSingle(k[c]!)) continue;
        for (const v of valuesOf(k[c]!)) {
          const touching = [...new Set(g.nbrs[c]!.map((d) => id[d]!).filter((r) => r >= 0 && list[r]!.value === v))];
          const merged = 1 + touching.reduce((s, r) => s + list[r]!.cells.length, 0);
          if (merged > v) {
            if (emit({ kind: "too-big", level: 0, vars: [c], keep: g.full & ~bit(v), because: touching.flatMap((r) => list[r]!.cells), data: { value: v, size: merged } })) return true;
            continue;
          }
          if (reach(k, [c], v) < v && emit({ kind: "no-room", level: 0, vars: [c], keep: g.full & ~bit(v), because: [], data: { value: v } })) return true;
        }
      }
      return true;
    },
  };
  const critical: Rule = {
    level: 1,
    kinds: ["critical"],
    run(live, emit) {
      const k = live.slice();
      const { id, list } = groups(g, placed(k));
      for (const grp of list) {
        const v = grp.value;
        if (grp.cells.length >= v) continue;
        // every cell the group could still grow into, checked one at a time
        const seen = new Uint8Array(g.n);
        const area: number[] = [];
        const stack = grp.cells.slice();
        for (const c of stack) seen[c] = 1;
        while (stack.length) {
          const c = stack.pop()!;
          if (id[c] !== id[grp.cells[0]!]) area.push(c);
          for (const d of g.nbrs[c]!) {
            if (seen[d] || !(k[d]! & bit(v))) continue;
            seen[d] = 1;
            stack.push(d);
          }
        }
        for (const x of area) {
          if (isSingle(k[x]!)) continue;
          if (reach(k, grp.cells, v, x) < v && emit({ kind: "critical", level: 1, vars: [x], keep: bit(v), because: grp.cells, data: { value: v } })) return true;
        }
      }
      return true;
    },
  };
  const m: Model = {
    n: g.n,
    constraints: [],
    rules: [regionsRule, critical],
    countLevel: 1,
    complete: (k) => groups(g, placed(k)).list.every((grp) => grp.cells.length === grp.value),
  };
  m.rules.push(trialRule(m, 2, 1));
  modelCache.set(p, m);
  return m;
}

export function initialDoms(p: FillingPuzzle): Doms {
  const g = geometry(p);
  return Int32Array.from(p.clues, (v) => (v > 0 ? bit(v) : g.full));
}

const analyses = new WeakMap<FillingPuzzle, Analysis>();

/** Unique-solution analysis, memoized per puzzle. `solution` holds the number per cell. */
export function analyze(p: FillingPuzzle): Analysis {
  let a = analyses.get(p);
  if (!a) analyses.set(p, a = analyzeModel(model(p), initialDoms(p), 2));
  return a;
}

/** Board masks as domains; with a unique solution, masks that rule out the solution are ignored. */
export function readMasks(p: FillingPuzzle, s: FillingState): Doms {
  const a = analyze(p);
  const sol = a.count === 1 ? a.solution : null;
  const g = geometry(p);
  return Int32Array.from(s.doms, (m, c) => (p.clues[c]! > 0 ? bit(p.clues[c]!) : !sol || m & bit(sol[c]!) ? m & g.full : g.full));
}

// --- state ---

export function reduce(p: FillingPuzzle, s: FillingState, a: FillingAction): FillingState {
  const g = geometry(p);
  let next: number[] | null = null;
  for (const c of a.cells) {
    if (!(c >= 0 && c < g.n) || p.clues[c]! > 0) continue;
    const cur = s.doms[c]!;
    const m = a.type === "set" ? a.mask & g.full
      : a.type === "clear" ? g.full
      : a.type === "narrow" ? cur & a.keep
      : a.value >= 1 && a.value <= g.top ? (cur === g.full ? bit(a.value) : cur ^ bit(a.value)) : cur;
    if (!m || m === cur) continue;
    next ??= s.doms.slice();
    next[c] = m;
  }
  return next ? { doms: next } : s;
}

/** Number shown in each cell (0 where nothing is placed). */
export const shownNumbers = (p: FillingPuzzle, doms: readonly number[]): number[] =>
  doms.map((m, c) => (p.clues[c]! > 0 ? p.clues[c]! : isSingle(m) ? valueOf(m) : 0));

export interface FillingConflicts extends Record<string, number[]> {
  /** Cells in a group of equal numbers that's too big, or walled in too small. */
  regions: number[];
}

export function findConflicts(p: FillingPuzzle, doms: readonly number[]): FillingConflicts {
  const g = geometry(p);
  const nums = shownNumbers(p, doms);
  const { list } = groups(g, (c) => nums[c]!);
  const bad: number[] = [];
  for (const grp of list) {
    if (grp.cells.length > grp.value) bad.push(...grp.cells);
    else if (grp.cells.length < grp.value) {
      // walled in: no empty cell next to it to grow into
      const open = grp.cells.some((c) => g.nbrs[c]!.some((d) => nums[d] === 0));
      if (!open) bad.push(...grp.cells);
    }
  }
  return { regions: bad };
}

export function isSolved(p: FillingPuzzle, s: FillingState): boolean {
  const g = geometry(p);
  const nums = shownNumbers(p, s.doms);
  if (nums.some((v) => v === 0)) return false;
  return groups(g, (c) => nums[c]!).list.every((grp) => grp.cells.length === grp.value);
}

// --- formats ---

const SGT_RE = /^(\d+)(?:x(\d+))?:([a-z0-9]+)$/;

/** Simon Tatham's Filling game id: `WxH:` then a digit per numbered cell (0 also means empty) and `a`–`z` for 1–26 empty cells. */
export const sgtFormat: Format<FillingPuzzle> = {
  id: "sgt",
  label: "game id (WxH:…)",
  detect: (t) => SGT_RE.test(t.trim()),
  parse(t) {
    const m = SGT_RE.exec(t.trim());
    if (!m) throw new Error("expected WxH:desc, e.g. 7x7:6b2b2…");
    const w = Number(m[1]), h = Number(m[2] ?? m[1]);
    if (!(w >= 1 && h >= 1 && w <= 40 && h <= 40)) throw new Error("size must be between 1×1 and 40×40");
    const top = maxNumber(w, h);
    const clues: number[] = [];
    for (const ch of m[3]!) {
      if (ch >= "0" && ch <= "9") {
        if (Number(ch) > top) throw new Error(`${ch} is too big for a ${w}×${h} board`);
        clues.push(Number(ch));
      } else for (let i = 0; i < ch.charCodeAt(0) - 96; i++) clues.push(0);
    }
    if (clues.length !== w * h) throw new Error(clues.length < w * h ? "not enough data to fill the grid" : "too much data for the grid");
    return { w, h, clues };
  },
  serialize(p) {
    let out = "", run = 0;
    const flush = () => {
      for (; run > 26; run -= 26) out += "z";
      if (run) out += String.fromCharCode(96 + run);
      run = 0;
    };
    for (const v of p.clues) {
      if (!v) {
        run++;
        continue;
      }
      flush();
      out += String(v);
    }
    flush();
    return `${p.w}x${p.h}:${out}`;
  },
};

// --- hints ---

export function wrongHint(p: FillingPuzzle, s: FillingState): Hint<FillingAction> | null {
  const a = analyze(p);
  if (a.count !== 1 || !a.solution) return null;
  const g = geometry(p);
  const sol = a.solution;
  const wrong = s.doms.flatMap((m, c) => (p.clues[c]! === 0 && m !== g.full && !(m & bit(sol[c]!)) ? [c] : []));
  if (!wrong.length) return null;
  return {
    message: `${cellList(p, wrong)} ${wrong.length === 1 ? "has" : "have"} a number or candidates that rule out the answer`,
    focus: { cells: wrong, because: [] } satisfies Focus,
    actions: [{ type: "clear", cells: wrong }],
  };
}

export function hint(p: FillingPuzzle, s: FillingState): Hint<FillingAction> | null {
  const c = findConflicts(p, s.doms);
  if (c.regions.length) return { message: `the numbers on ${cellList(p, c.regions)} don't make a region of the right size`, focus: { cells: c.regions, because: [] } satisfies Focus };
  const a = analyze(p);
  if (a.count === 0) return { message: "this puzzle has no solution" };
  if (a.count === 2) return { message: "this puzzle has more than one solution, so it can need a guess" };
  return { message: "none of the techniques you have hints on applies here" };
}

function rate(p: FillingPuzzle): { label: string; score: number } {
  const a = analyze(p);
  if (a.count === 0) return { label: "no solution", score: -1 };
  if (a.count === 2) return { label: "multiple solutions", score: 10 };
  if (a.level === null) return { label: "needs guessing", score: 3 };
  return { label: LEVEL_NAMES[a.level]!, score: a.level };
}

// --- generation ---

/**
 * A random filled board after tatham's: cells start alone, and any region touching a region of
 * its own size merges with its smallest neighbor that keeps it within the largest number;
 * leftover 1s are merged into neighbors where that keeps every region legal. Null if stuck.
 */
export function makeBoard(w: number, h: number, rng: Rng): number[] | null {
  const n = w * h, top = maxNumber(w, h);
  const nbrs = neighbours(w, h);
  const parent = Int32Array.from({ length: n }, (_, i) => i);
  const size = new Int32Array(n).fill(1);
  const find = (a: number): number => {
    while (parent[a] !== a) a = parent[a] = parent[parent[a]!]!;
    return a;
  };
  const order = rng.shuffle(Array.from({ length: n }, (_, i) => i));
  for (let changed = true, guard = 0; changed && guard < 10 * n; guard++) {
    changed = false;
    for (const c of order) {
      const r = find(c), sz = size[r]!;
      let clash = false, best = -1, bestSize = top - sz + 1;
      for (const d of rng.shuffle(nbrs[c]!.slice())) {
        const q = find(d);
        if (q === r) continue;
        if (size[q] === sz) clash = true;
        if (size[q]! < bestSize && rng.int(10)) {
          bestSize = size[q]!;
          best = q;
        }
      }
      if (!clash) continue;
      if (best < 0) return null;
      parent[best] = r;
      size[r]! += size[best]!;
      changed = true;
    }
  }
  let board = Array.from({ length: n }, (_, c) => size[find(c)]!);
  const geo: Geometry = { w, h, n, top, full: fullMask(top), nbrs };
  const legal = (b: number[]) => groups(geo, (x) => b[x]!).list.every((gr) => gr.cells.length === gr.value);
  // a 1 joins a neighboring region when the grown region keeps the board legal
  for (let changed = true; changed;) {
    changed = false;
    for (let c = 0; c < n && !changed; c++) {
      if (board[c] !== 1) continue;
      for (const d of nbrs[c]!) {
        const { list } = groups(geo, (x) => board[x]!);
        const region = list.find((gr) => gr.cells.includes(d))!;
        const grown = region.cells.length + 1;
        if (grown > top) continue;
        const trial = board.slice();
        for (const x of [...region.cells, c]) trial[x] = grown;
        if (!legal(trial)) continue;
        board = trial;
        changed = true;
        break;
      }
    }
  }
  return board;
}

const COSTLY_TRIES = 12;
const EXACT_ATTEMPTS = 30;
const MAX_ATTEMPTS = 300;

/**
 * Deterministic in (params, rng): a random filled board; whole regions blanked where logic still
 * decides every cell, then single numbers (one level down first, then at the requested level).
 * Needs exactly the level when one turns up within EXACT_ATTEMPTS boards, else the hardest found.
 */
export async function generatePuzzle(w: number, h: number, level: Level, rng: Rng, ctx: GenerateContext): Promise<FillingPuzzle> {
  let best: { p: FillingPuzzle; level: number } | null = null;
  const g = geometry({ w, h, clues: [] });
  for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
    if (best && attempt >= EXACT_ATTEMPTS) break;
    await ctx.yield();
    const r = rng.fork(`attempt ${attempt}`);
    const board = makeBoard(w, h, r);
    if (!board) continue;
    const clues = board.slice();
    const check = (pass: number) => {
      const q = { w, h, clues: clues.slice() };
      return decides(model(q), initialDoms(q), pass);
    };
    const order = r.shuffle(Array.from({ length: w * h }, (_, i) => i));
    const { id, list } = groups(g, (c) => board[c]!);
    const first = level > 0 ? level - 1 : level;
    const triedRegion = new Uint8Array(list.length);
    for (const c of order) {
      if (triedRegion[id[c]!]) continue;
      triedRegion[id[c]!] = 1;
      await ctx.yield();
      const cells = list[id[c]!]!.cells;
      for (const x of cells) clues[x] = 0;
      if (!check(first)) for (const x of cells) clues[x] = board[x]!;
    }
    for (const pass of level > 0 ? [level - 1, level] : [level]) {
      const easier = pass > 0 && check(pass - 1);
      let tries = 0;
      for (const c of order) {
        if (!clues[c]) continue;
        if (pass === level && easier && ++tries > COSTLY_TRIES) break;
        await ctx.yield();
        const keep = clues[c]!;
        clues[c] = 0;
        if (!check(pass)) clues[c] = keep;
        else if (pass === level && easier && !check(pass - 1)) break;
      }
    }
    const p: FillingPuzzle = { w, h, clues };
    const got = levelNeeded(model(p), initialDoms(p), level);
    if (got === null) continue;
    if (got === level) return p;
    if (!best || got > best.level) best = { p, level: got };
  }
  if (best) return best.p;
  throw new Error("couldn't make a puzzle with these settings; try a different size");
}

export const filling: PuzzleDef<FillingPuzzle, FillingState, FillingAction, FillingInteraction, typeof params> = {
  id: "filling",
  name: "filling",
  aliases: ["fillomino", "allied occupation"],
  tags: ["logic", "grid", "numbers", "regions", "nikoli"],
  description: "write a number in every cell so the board splits into regions: each group of joined cells with the same number has exactly that many cells.",
  generatorVersion: 1,
  params,
  presets: [
    { label: "7×6 easy", params: { width: 7, height: 6, difficulty: "easy" } },
    { label: "9×7 easy", params: { width: 9, height: 7, difficulty: "easy" } },
    { label: "9×7 medium", params: { width: 9, height: 7, difficulty: "medium" } },
    { label: "9×7 hard", params: { width: 9, height: 7, difficulty: "hard" } },
    { label: "13×9 medium", params: { width: 13, height: 9, difficulty: "medium" } },
    { label: "17×13 easy", params: { width: 17, height: 13, difficulty: "easy" } },
  ],
  generate: (v: Values<typeof params>, rng, ctx) => generatePuzzle(v.width, v.height, LEVEL_NAMES.indexOf(v.difficulty as (typeof LEVEL_NAMES)[number]) as Level, rng, ctx),
  formats: [sgtFormat],
  init: (p) => {
    const g = geometry(p);
    return { doms: p.clues.map((v) => (v > 0 ? bit(v) : g.full)) };
  },
  initInteraction: (p) => ({ cursor: Math.max(0, p.clues.indexOf(0)), selection: [], candidates: false }),
  reduce,
  isRetraction: (a) => a.type === "toggle" || a.type === "clear",
  rules: (p) => [
    `write a number from 1 to ${maxNumber(p.w, p.h)} in every empty cell.`,
    "joined cells (side by side) with the same number form a region, and a region must have exactly as many cells as its number: a 3 sits in a group of three 3s, and so on.",
    "two different regions with the same number may not touch side by side, or they'd be one region.",
    "small numbers in a cell are your own notes of what it could still be.",
  ],
  isSolved,
  solve(p) {
    const a = analyze(p);
    return a.solution ? { doms: a.solution.map((v) => bit(v)) } : null;
  },
  hint,
  rate,
  describe: (p) => `${p.w}×${p.h}`,
};
