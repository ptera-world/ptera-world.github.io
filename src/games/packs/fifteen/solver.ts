import type { FifteenPuzzle, FifteenState } from "./logic";

export type GroupKind = "single" | "pair" | "last";

/** Home cells placed together; every earlier group stays untouched while this one is worked on. */
export interface Group {
  kind: GroupKind;
  cells: number[];
}

const solvedTile = (n: number, cell: number): number => (cell === n - 1 ? 0 : cell + 1);

/**
 * The order the hint method fills the board in: the top row or left column of what's left (whichever
 * side is longer), one tile at a time except the last two of each line, which go in as a pair, until a
 * 2×2 square remains.
 */
export function groups(w: number, h: number): Group[] {
  const out: Group[] = [];
  let x0 = 0, y0 = 0;
  for (;;) {
    const rows = h - y0, cols = w - x0;
    if (rows <= 2 && cols <= 2) {
      const cells: number[] = [];
      for (let y = y0; y < h; y++) for (let x = x0; x < w; x++) cells.push(y * w + x);
      out.push({ kind: "last", cells });
      return out;
    }
    if ((rows >= cols && rows > 2) || cols <= 2) {
      for (let x = x0; x < w - 2; x++) out.push({ kind: "single", cells: [y0 * w + x] });
      out.push({ kind: "pair", cells: [y0 * w + w - 2, y0 * w + w - 1] });
      y0++;
    } else {
      for (let y = y0; y < h - 2; y++) out.push({ kind: "single", cells: [y * w + x0] });
      out.push({ kind: "pair", cells: [(h - 2) * w + x0, (h - 1) * w + x0] });
      x0++;
    }
  }
}

const groupCache = new Map<string, Group[]>();
function groupsFor(p: FifteenPuzzle): Group[] {
  const key = `${p.w}x${p.h}`;
  let g = groupCache.get(key);
  if (!g) groupCache.set(key, (g = groups(p.w, p.h)));
  return g;
}

/** Tiles that belong in a group's cells (the gap is never a goal of its own). */
export function groupTiles(n: number, g: Group): number[] {
  return g.cells.map((c) => solvedTile(n, c)).filter((t) => t !== 0);
}

const groupDone = (tiles: readonly number[], g: Group): boolean => g.cells.every((c) => tiles[c] === solvedTile(tiles.length, c));

/**
 * Shortest sequence of single-tile moves (each the cell pressed) that puts the group's tiles home
 * without moving any locked cell. Null if impossible.
 */
function placeGroup(w: number, h: number, tiles: readonly number[], g: Group, locked: Uint8Array): number[] | null {
  const n = w * h;
  const region: number[] = [];
  const local = new Int32Array(n).fill(-1);
  for (let c = 0; c < n; c++) if (!locked[c]) { local[c] = region.length; region.push(c); }
  const m = region.length;
  const want = groupTiles(n, g);
  const k = want.length;
  const goal = want.map((t) => local[t === 0 ? n - 1 : t - 1]!);
  const start = [local[tiles.indexOf(0)]!, ...want.map((t) => local[tiles.indexOf(t)]!)];
  if (start.some((v) => v < 0) || goal.some((v) => v < 0)) return null;
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
    if (st.slice(1).every((v, i) => v === goal[i])) { found = code; break; }
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

const planCache = new WeakMap<readonly number[], Plan | null>();

/** The group to work on now and how to finish it; null when solved (or stuck). */
export function nextPlan(p: FifteenPuzzle, s: Pick<FifteenState, "tiles">): Plan | null {
  if (planCache.has(s.tiles)) return planCache.get(s.tiles)!;
  const n = p.w * p.h;
  const gs = groupsFor(p);
  const locked = new Uint8Array(n);
  let plan: Plan | null = null;
  for (let i = 0; i < gs.length; i++) {
    const g = gs[i]!;
    if (!groupDone(s.tiles, g)) {
      const path = placeGroup(p.w, p.h, s.tiles, g, locked);
      plan = path ? { group: g, index: i, path } : null;
      break;
    }
    for (const c of g.cells) locked[c] = 1;
  }
  planCache.set(s.tiles, plan);
  return plan;
}

/** Every move the hint method makes from `s` to the solution, or null if it gets stuck. */
export function fullPlan(p: FifteenPuzzle, s: Pick<FifteenState, "tiles">): number[] | null {
  let tiles = s.tiles.slice();
  const out: number[] = [];
  for (let guard = 0; guard < 1000; guard++) {
    if (tiles.every((t, i) => t === solvedTile(tiles.length, i))) return out;
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
