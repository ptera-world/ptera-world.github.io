import { slideGoal, type SlidePuzzle } from "./slide";

export type GroupKind = "single" | "pair" | "last";

/** Home cells placed together; every earlier group stays untouched while this one is worked on. */
export interface Group {
  kind: GroupKind;
  cells: number[];
}

/**
 * The order the hint method fills the board in: a whole edge line of what's left at a time (a row
 * when there are at least as many rows left as columns), one tile at a time except the last two,
 * which go in as a pair, until a 2×2 square remains. Lines are peeled from the side away from the
 * gap's home, so the last square is the one holding it.
 */
export function groups(w: number, h: number, gapHome = w * h - 1): Group[] {
  const out: Group[] = [];
  const gx = gapHome % w, gy = Math.floor(gapHome / w);
  let x0 = 0, y0 = 0, x1 = w - 1, y1 = h - 1;
  for (;;) {
    const rows = y1 - y0 + 1, cols = x1 - x0 + 1;
    if (rows <= 2 && cols <= 2) {
      const cells: number[] = [];
      for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) cells.push(y * w + x);
      out.push({ kind: "last", cells });
      return out;
    }
    if ((rows >= cols && rows > 2) || cols <= 2) {
      const y = gy === y0 ? y1 : y0;
      for (let x = x0; x < x1 - 1; x++) out.push({ kind: "single", cells: [y * w + x] });
      out.push({ kind: "pair", cells: [y * w + x1 - 1, y * w + x1] });
      if (y === y0) y0++; else y1--;
    } else {
      const x = gx === x0 ? x1 : x0;
      for (let y = y0; y < y1 - 1; y++) out.push({ kind: "single", cells: [y * w + x] });
      out.push({ kind: "pair", cells: [(y1 - 1) * w + x, y1 * w + x] });
      if (x === x0) x0++; else x1--;
    }
  }
}


const groupCache = new Map<string, Group[]>();
function groupsFor(p: SlidePuzzle): Group[] {
  const key = `${p.w}x${p.h}${p.goal ?? "order"}`;
  let g = groupCache.get(key);
  if (!g) groupCache.set(key, (g = groups(p.w, p.h, slideGoal(p).indexOf(0))));
  return g;
}

/** Tiles that belong in a group's cells (the gap is never a goal of its own). */
export function groupTiles(p: SlidePuzzle, g: Group): number[] {
  const goal = slideGoal(p);
  return g.cells.map((c) => goal[c]!).filter((t) => t !== 0);
}

const groupDone = (goal: readonly number[], tiles: readonly number[], g: Group): boolean => g.cells.every((c) => tiles[c] === goal[c]);

/**
 * Shortest sequence of single-tile moves (each the cell pressed) that puts the group's tiles home
 * without moving any locked cell. Null if impossible.
 */
function placeGroup(p: SlidePuzzle, tiles: readonly number[], g: Group, locked: Uint8Array): number[] | null {
  const { w, h } = p;
  const n = w * h;
  const goal = slideGoal(p);
  const region: number[] = [];
  const local = new Int32Array(n).fill(-1);
  for (let c = 0; c < n; c++) if (!locked[c]) { local[c] = region.length; region.push(c); }
  const m = region.length;
  const want = groupTiles(p, g);
  const k = want.length;
  const goalAt = want.map((t) => local[goal.indexOf(t)]!);
  const start = [local[tiles.indexOf(0)]!, ...want.map((t) => local[tiles.indexOf(t)]!)];
  if (start.some((v) => v < 0) || goalAt.some((v) => v < 0)) return null;
  const nb: number[][] = region.map((c) => {
    const x = c % w, y = Math.floor(c / w);
    const out: number[] = [];
    if (x > 0 && !locked[c - 1]) out.push(local[c - 1]!);
    if (x < w - 1 && !locked[c + 1]) out.push(local[c + 1]!);
    if (y > 0 && !locked[c - w]) out.push(local[c - w]!);
    if (y < h - 1 && !locked[c + w]) out.push(local[c + w]!);
    return out;
  });
  const size = m ** (k + 1);
  const encode = (st: number[]) => st.reduceRight((acc, v) => acc * m + v, 0);
  const decode = (code: number) => {
    const st: number[] = [];
    for (let i = 0; i <= k; i++) { st.push(code % m); code = Math.floor(code / m); }
    return st;
  };
  const parent = new Int32Array(size).fill(-1);
  const s0 = encode(start);
  parent[s0] = s0;
  const queue = new Int32Array(size);
  let head = 0, tail = 0;
  queue[tail++] = s0;
  let found = -1;
  while (head < tail) {
    const code = queue[head++]!;
    const st = decode(code);
    if (st.slice(1).every((v, i) => v === goalAt[i])) { found = code; break; }
    const gap = st[0]!;
    for (const to of nb[gap]!) {
      const next = st.slice();
      next[0] = to;
      for (let i = 1; i <= k; i++) if (next[i] === to) next[i] = gap;
      const nc = encode(next);
      if (parent[nc] !== -1) continue;
      parent[nc] = code;
      queue[tail++] = nc;
    }
  }
  if (found < 0) return null;
  const path: number[] = [];
  for (let c = found; c !== s0; c = parent[c]!) path.push(region[decode(c)[0]!]!);
  return path.reverse();
}

export interface Plan {
  group: Group;
  index: number;
  /** Cells to press, one tile each, that finish this group. */
  path: number[];
}

const planCache = new WeakMap<readonly number[], Map<SlidePuzzle, Plan | null>>();

/** The group to work on now and how to finish it; null when solved (or stuck). */
export function nextPlan(p: SlidePuzzle, s: { tiles: readonly number[] }): Plan | null {
  const byPuzzle = planCache.get(s.tiles) ?? new Map<SlidePuzzle, Plan | null>();
  planCache.set(s.tiles, byPuzzle);
  if (byPuzzle.has(p)) return byPuzzle.get(p)!;
  const goal = slideGoal(p);
  const gs = groupsFor(p);
  const locked = new Uint8Array(p.w * p.h);
  let plan: Plan | null = null;
  for (let i = 0; i < gs.length; i++) {
    const g = gs[i]!;
    if (!groupDone(goal, s.tiles, g)) {
      const path = placeGroup(p, s.tiles, g, locked);
      plan = path ? { group: g, index: i, path } : null;
      break;
    }
    for (const c of g.cells) locked[c] = 1;
  }
  byPuzzle.set(p, plan);
  return plan;
}

/** Every move the hint method makes from `s` to the solution, or null if it gets stuck. */
export function fullPlan(p: SlidePuzzle, s: { tiles: readonly number[] }): number[] | null {
  const goal = slideGoal(p);
  let tiles = s.tiles.slice();
  const out: number[] = [];
  for (let guard = 0; guard < 1000; guard++) {
    if (tiles.every((t, i) => t === goal[i])) return out;
    const plan = nextPlan(p, { tiles });
    if (!plan) return null;
    for (const c of plan.path) {
      const g = tiles.indexOf(0);
      tiles = tiles.slice();
      tiles[g] = tiles[c]!;
      tiles[c] = 0;
      out.push(c);
    }
  }
  return null;
}
