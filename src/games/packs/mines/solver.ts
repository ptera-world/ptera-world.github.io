import type { Rng } from "../../core/rng";
import type { GenerateContext } from "../../core/types";

/**
 * Knowledge grid used by every solver entry point: one Int8 per cell.
 * UNKNOWN = undetermined, MINE = known mine, 0..8 = known safe cell showing that number.
 */
export const UNKNOWN = -1;
export const MINE = 9;

/**
 * 1 = single-number logic (plus "all mines found" / "every hidden cell is a mine"),
 * 2 = comparing two overlapping numbers,
 * 3 = enumerating every arrangement of a frontier region together with the global mine count.
 */
export type Level = 1 | 2 | 3;

export interface Deduction {
  level: Level;
  safe: number[];
  mines: number[];
  /** Revealed cells whose numbers justify this deduction (empty for global-count reasoning). */
  sources: number[];
  /** Level 3 or count-based: mines still unaccounted for when this was deduced. */
  remaining?: number;
}

const nbCache = new Map<string, number[][]>();

/** 8-neighborhood of every cell, row-major. Shared and must not be mutated. */
export function neighbourTable(w: number, h: number): number[][] {
  const key = `${w}x${h}`;
  let t = nbCache.get(key);
  if (t) return t;
  t = [];
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const list: number[] = [];
      for (let dy = -1; dy <= 1; dy++) {
        for (let dx = -1; dx <= 1; dx++) {
          if (!dx && !dy) continue;
          const nx = x + dx, ny = y + dy;
          if (nx >= 0 && ny >= 0 && nx < w && ny < h) list.push(ny * w + nx);
        }
      }
      t.push(list);
    }
  }
  nbCache.set(key, t);
  return t;
}

export function countNumbers(w: number, h: number, mines: ArrayLike<number>): number[] {
  const nb = neighbourTable(w, h);
  const out: number[] = [];
  for (let c = 0; c < w * h; c++) {
    let n = 0;
    for (const d of nb[c]!) n += mines[d] ? 1 : 0;
    out.push(n);
  }
  return out;
}

function isNumber(k: number): boolean {
  return k >= 0 && k <= 8;
}

/** Single-constraint deduction at a revealed cell, or null. */
export function deduceAt(K: Int8Array, nb: number[][], c: number): Deduction | null {
  const v = K[c]!;
  if (!isNumber(v)) return null;
  const unknown: number[] = [];
  let known = 0;
  for (const d of nb[c]!) {
    if (K[d] === UNKNOWN) unknown.push(d);
    else if (K[d] === MINE) known++;
  }
  if (unknown.length === 0) return null;
  const r = v - known;
  if (r === 0) return { level: 1, safe: unknown, mines: [], sources: [c] };
  if (r === unknown.length) return { level: 1, safe: [], mines: unknown, sources: [c] };
  return null;
}

/** "No mines left" / "every hidden cell is a mine". */
export function deduceCount(K: Int8Array, total: number): Deduction | null {
  const unknown: number[] = [];
  let known = 0;
  for (let c = 0; c < K.length; c++) {
    if (K[c] === UNKNOWN) unknown.push(c);
    else if (K[c] === MINE) known++;
  }
  if (unknown.length === 0) return null;
  const r = total - known;
  if (r === 0) return { level: 1, safe: unknown, mines: [], sources: [], remaining: r };
  if (r === unknown.length) return { level: 1, safe: [], mines: unknown, sources: [], remaining: r };
  return null;
}

function constraint(K: Int8Array, nb: number[][], c: number): { cells: number[]; r: number } | null {
  const v = K[c]!;
  if (!isNumber(v)) return null;
  const cells: number[] = [];
  let known = 0;
  for (const d of nb[c]!) {
    if (K[d] === UNKNOWN) cells.push(d);
    else if (K[d] === MINE) known++;
  }
  return cells.length ? { cells, r: v - known } : null;
}

/** Two-constraint deduction from revealed cells a and b, or null. */
export function deducePair(K: Int8Array, nb: number[][], a: number, b: number): Deduction | null {
  const A = constraint(K, nb, a), B = constraint(K, nb, b);
  if (!A || !B) return null;
  const inB = new Set(B.cells);
  const inter = A.cells.filter((c) => inB.has(c));
  if (inter.length === 0) return null;
  const inI = new Set(inter);
  const aOnly = A.cells.filter((c) => !inI.has(c));
  const bOnly = B.cells.filter((c) => !inI.has(c));
  const minI = Math.max(0, A.r - aOnly.length, B.r - bOnly.length);
  const maxI = Math.min(A.r, B.r, inter.length);
  if (minI > maxI) return null;
  const safe: number[] = [], mines: number[] = [];
  const side = (only: number[], r: number) => {
    if (!only.length) return;
    if (r - minI === 0) safe.push(...only);
    else if (r - maxI === only.length) mines.push(...only);
  };
  side(aOnly, A.r);
  side(bOnly, B.r);
  if (maxI === 0) safe.push(...inter);
  else if (minI === inter.length) mines.push(...inter);
  if (!safe.length && !mines.length) return null;
  return { level: 2, safe, mines, sources: [a, b] };
}

/** Every pairwise deduction available right now, in cell order. */
export function deducePairs(K: Int8Array, w: number, h: number, nb: number[][], limit = Infinity): Deduction[] {
  const out: Deduction[] = [];
  for (let a = 0; a < K.length; a++) {
    if (!isNumber(K[a]!) || !nb[a]!.some((d) => K[d] === UNKNOWN)) continue;
    const ax = a % w, ay = Math.floor(a / w);
    for (let y = Math.max(0, ay - 2); y <= Math.min(h - 1, ay + 2); y++) {
      for (let x = Math.max(0, ax - 2); x <= Math.min(w - 1, ax + 2); x++) {
        const b = y * w + x;
        if (b <= a) continue;
        const d = deducePair(K, nb, a, b);
        if (d) {
          out.push(d);
          if (out.length >= limit) return out;
        }
      }
    }
  }
  return out;
}

/**
 * Region enumeration plus global mine count. Each connected frontier region is enumerated
 * exhaustively (up to `nodeBudget` search nodes per region; a region over budget is treated as
 * fully undetermined, which keeps the result sound).
 */
export function deduceGlobal(K: Int8Array, nb: number[][], total: number, nodeBudget = 200_000): Deduction | null {
  const n = K.length;
  let knownMines = 0;
  const frontierOf = new Int32Array(n).fill(-1);
  const constraints: { cells: number[]; r: number; src: number }[] = [];
  for (let c = 0; c < n; c++) {
    if (K[c] === MINE) knownMines++;
    const con = constraint(K, nb, c);
    if (con) constraints.push({ ...con, src: c });
  }
  const R = total - knownMines;
  if (R < 0) return null;

  // union-find over unknown cells that share a constraint
  const parent = new Int32Array(n).map((_, i) => i);
  const find = (x: number): number => {
    while (parent[x] !== x) {
      parent[x] = parent[parent[x]!]!;
      x = parent[x]!;
    }
    return x;
  };
  for (const con of constraints) {
    for (const c of con.cells) frontierOf[c] = 0;
    for (let i = 1; i < con.cells.length; i++) parent[find(con.cells[i]!)] = find(con.cells[0]!);
  }
  const groups = new Map<number, number[]>();
  const interior: number[] = [];
  for (let c = 0; c < n; c++) {
    if (K[c] !== UNKNOWN) continue;
    if (frontierOf[c] === -1) {
      interior.push(c);
      continue;
    }
    const r = find(c);
    let g = groups.get(r);
    if (!g) groups.set(r, (g = []));
    g.push(c);
  }
  if (groups.size === 0 && interior.length === 0) return null;

  interface Region {
    cells: number[];
    /** feasible[k]: some arrangement with k mines exists */
    feasible: boolean[];
    canMine: Uint8Array[];
    canSafe: Uint8Array[];
    opaque: boolean;
    sources: number[];
  }
  const regions: Region[] = [];
  for (const cells of groups.values()) {
    const idx = new Map(cells.map((c, i) => [c, i]));
    const cons = constraints.filter((con) => idx.has(con.cells[0]!));
    // order cells so each constraint closes early: BFS through shared constraints
    const consOf: number[][] = cells.map(() => []);
    cons.forEach((con, ci) => { for (const c of con.cells) consOf[idx.get(c)!]!.push(ci); });
    const order: number[] = [];
    const seen = new Uint8Array(cells.length);
    const queue = [0];
    seen[0] = 1;
    while (queue.length) {
      const i = queue.shift()!;
      order.push(i);
      for (const ci of consOf[i]!) {
        for (const c of cons[ci]!.cells) {
          const j = idx.get(c)!;
          if (!seen[j]) { seen[j] = 1; queue.push(j); }
        }
      }
    }
    const m = cells.length;
    const assign = new Int8Array(m).fill(-1);
    const mines = new Int32Array(cons.length);
    const open = new Int32Array(cons.length);
    cons.forEach((con, ci) => { open[ci] = con.cells.length; });
    const feasible = Array.from({ length: m + 1 }, () => false);
    const canMine = Array.from({ length: m + 1 }, () => new Uint8Array(m));
    const canSafe = Array.from({ length: m + 1 }, () => new Uint8Array(m));
    let nodes = 0;
    let opaque = false;
    const rec = (pos: number, count: number): void => {
      if (opaque) return;
      if (++nodes > nodeBudget) { opaque = true; return; }
      if (count > R) return;
      if (pos === m) {
        feasible[count] = true;
        const cm = canMine[count]!, cs = canSafe[count]!;
        for (let i = 0; i < m; i++) {
          if (assign[i]) cm[i] = 1;
          else cs[i] = 1;
        }
        return;
      }
      const i = order[pos]!;
      for (const v of [0, 1]) {
        let ok = true;
        for (const ci of consOf[i]!) {
          const nm = mines[ci]! + v, no = open[ci]! - 1;
          const r = cons[ci]!.r;
          if (nm > r || nm + no < r) { ok = false; break; }
        }
        if (!ok) continue;
        assign[i] = v;
        for (const ci of consOf[i]!) { mines[ci] = mines[ci]! + v; open[ci] = open[ci]! - 1; }
        rec(pos + 1, count + v);
        for (const ci of consOf[i]!) { mines[ci] = mines[ci]! - v; open[ci] = open[ci]! + 1; }
        assign[i] = -1;
      }
    };
    rec(0, 0);
    if (opaque) {
      for (let k = 0; k <= m; k++) {
        feasible[k] = true;
        canMine[k]!.fill(1);
        canSafe[k]!.fill(1);
      }
    }
    regions.push({ cells, feasible, canMine, canSafe, opaque, sources: cons.map((c) => c.src) });
  }

  // achievable totals over regions before / after each index
  const maxSum = regions.reduce((a, r) => a + r.cells.length, 0);
  const addRegion = (set: Uint8Array, r: Region): Uint8Array => {
    const out = new Uint8Array(maxSum + 1);
    for (let s = 0; s <= maxSum; s++) {
      if (!set[s]) continue;
      for (let k = 0; k < r.feasible.length; k++) if (r.feasible[k] && s + k <= maxSum) out[s + k] = 1;
    }
    return out;
  };
  const base = new Uint8Array(maxSum + 1);
  base[0] = 1;
  const prefix: Uint8Array[] = [base];
  for (const r of regions) prefix.push(addRegion(prefix[prefix.length - 1]!, r));
  const suffix: Uint8Array[] = Array.from({ length: regions.length + 1 }, () => base);
  for (let i = regions.length - 1; i >= 0; i--) suffix[i] = addRegion(suffix[i + 1]!, regions[i]!);
  const I = interior.length;
  const interiorOk = (rest: number) => rest >= 0 && rest <= I;

  const safe: number[] = [], minesOut: number[] = [];
  const sources = new Set<number>();
  regions.forEach((reg, ri) => {
    if (reg.opaque) return;
    const pre = prefix[ri]!, suf = suffix[ri + 1]!;
    const others = new Uint8Array(maxSum + 1);
    for (let a = 0; a <= maxSum; a++) {
      if (!pre[a]) continue;
      for (let b = 0; a + b <= maxSum; b++) if (suf[b]) others[a + b] = 1;
    }
    const okK: number[] = [];
    for (let k = 0; k < reg.feasible.length; k++) {
      if (!reg.feasible[k]) continue;
      let ok = false;
      for (let s = 0; s <= maxSum && !ok; s++) if (others[s] && interiorOk(R - k - s)) ok = true;
      if (ok) okK.push(k);
    }
    if (!okK.length) return;
    reg.cells.forEach((c, i) => {
      if (okK.every((k) => !reg.canMine[k]![i])) safe.push(c);
      else if (okK.every((k) => !reg.canSafe[k]![i])) minesOut.push(c);
      else return;
      for (const s of reg.sources) sources.add(s);
    });
  });
  if (I > 0) {
    const all = prefix[regions.length]!;
    let lo = Infinity, hi = -Infinity;
    for (let s = 0; s <= maxSum; s++) {
      if (!all[s] || !interiorOk(R - s)) continue;
      lo = Math.min(lo, R - s);
      hi = Math.max(hi, R - s);
    }
    if (hi === 0) safe.push(...interior);
    else if (lo === I) minesOut.push(...interior);
  }
  if (!safe.length && !minesOut.length) return null;
  return { level: 3, safe, mines: minesOut, sources: [...sources].sort((a, b) => a - b), remaining: R };
}

export interface SolveResult {
  known: Int8Array;
  /** Hardest level actually needed (0 if nothing was deduced). */
  maxLevel: 0 | Level;
  /** Every safe cell was reached. */
  complete: boolean;
}

/**
 * Solve a layout by logic alone, starting from `known` (typically just the start cell revealed),
 * using techniques up to `level`. Safe deductions are revealed from the layout.
 */
export function solveLayout(
  w: number, h: number, mines: ArrayLike<number>, known: Int8Array, level: Level,
): SolveResult {
  const n = w * h;
  const nb = neighbourTable(w, h);
  const numbers = countNumbers(w, h, mines);
  let total = 0;
  for (let c = 0; c < n; c++) total += mines[c] ? 1 : 0;
  const K = Int8Array.from(known);
  let safeLeft = 0;
  for (let c = 0; c < n; c++) if (!mines[c] && !isNumber(K[c]!)) safeLeft++;
  let maxLevel: 0 | Level = 0;
  const queue: number[] = [];
  const queued = new Uint8Array(n);
  const push = (c: number) => {
    if (isNumber(K[c]!) && !queued[c]) { queued[c] = 1; queue.push(c); }
  };
  for (let c = 0; c < n; c++) push(c);
  const apply = (d: Deduction) => {
    if (d.level > maxLevel) maxLevel = d.level;
    for (const c of d.safe) {
      if (K[c] !== UNKNOWN) continue;
      if (mines[c]) throw new Error("mines solver: unsound safe deduction");
      K[c] = numbers[c]!;
      safeLeft--;
      push(c);
      for (const e of nb[c]!) push(e);
    }
    for (const c of d.mines) {
      if (K[c] !== UNKNOWN) continue;
      if (!mines[c]) throw new Error("mines solver: unsound mine deduction");
      K[c] = MINE;
      for (const e of nb[c]!) push(e);
    }
  };
  for (;;) {
    while (queue.length && safeLeft > 0) {
      const c = queue.pop()!;
      queued[c] = 0;
      const d = deduceAt(K, nb, c);
      if (d) apply(d);
    }
    if (safeLeft === 0) break;
    const g = deduceCount(K, total);
    if (g) { apply(g); continue; }
    if (level < 2) break;
    const pairs = deducePairs(K, w, h, nb);
    if (pairs.length) { pairs.forEach(apply); continue; }
    if (level < 3) break;
    const d3 = deduceGlobal(K, nb, total);
    if (d3) { apply(d3); continue; }
    break;
  }
  return { known: K, maxLevel, complete: safeLeft === 0 };
}

/** Knowledge with `start` revealed (or nothing, if start is null). */
export function startKnowledge(w: number, h: number, mines: ArrayLike<number>, start: number | null): Int8Array {
  const K = new Int8Array(w * h).fill(UNKNOWN);
  if (start !== null && !mines[start]) K[start] = countNumbers(w, h, mines)[start]!;
  return K;
}

/** Cells kept mine-free around the start: its 3×3 block when the board has room, else just itself. */
export function startZone(w: number, h: number, start: number, count: number): number[] {
  const zone = [start, ...neighbourTable(w, h)[start]!];
  return count <= w * h - zone.length ? zone : [start];
}

export interface LayoutOptions {
  w: number;
  h: number;
  count: number;
  start: number;
  /** null = plain random layout, guessing may be required. */
  level: Level | null;
}

const ATTEMPTS = 40;
const EXACT_ATTEMPTS = 8;

/**
 * Deterministic in (options, rng). With a level, the result is solvable from `start` by logic up to
 * that level, preferring layouts that need exactly that level. Unsolvable layouts are repaired by
 * moving stuck frontier mines elsewhere, then re-solved from scratch.
 */
export async function generateLayout(o: LayoutOptions, rng: Rng, ctx: GenerateContext): Promise<{ mines: number[]; level: 0 | Level | null }> {
  const n = o.w * o.h;
  if (o.count < 0 || o.count > n - 1) throw new Error(`can't fit ${o.count} mines on ${n} cells`);
  const zone = new Set(startZone(o.w, o.h, o.start, o.count));
  const placeable = [...Array(n).keys()].filter((c) => !zone.has(c));
  const place = (r: Rng) => {
    const mines = Array.from({ length: n }, () => 0);
    for (const c of r.shuffle(placeable.slice()).slice(0, o.count)) mines[c] = 1;
    return mines;
  };
  if (o.level === null) return { mines: place(rng), level: null };
  const level = o.level;
  const nb = neighbourTable(o.w, o.h);
  const budget = Math.max(200, 3 * n);
  let fallback: { mines: number[]; level: 0 | Level } | null = null;
  for (let attempt = 0; attempt < ATTEMPTS; attempt++) {
    const r = rng.fork(`attempt${attempt}`);
    const mines = place(r);
    for (let it = 0; it < budget; it++) {
      await ctx.yield();
      const res = solveLayout(o.w, o.h, mines, startKnowledge(o.w, o.h, mines, o.start), level);
      if (res.complete) {
        if (res.maxLevel >= level || level === 1) return { mines, level: res.maxLevel };
        if (!fallback || res.maxLevel > fallback.level) fallback = { mines: mines.slice(), level: res.maxLevel };
        break;
      }
      perturb(mines, res.known, nb, zone, r);
    }
    if (fallback && attempt + 1 >= EXACT_ATTEMPTS) return fallback;
  }
  if (fallback) return fallback;
  throw new Error("couldn't build a guess-free board with these settings; try fewer mines or a lower difficulty");
}

function perturb(mines: number[], K: Int8Array, nb: number[][], zone: Set<number>, rng: Rng): void {
  const n = mines.length;
  const frontier = new Uint8Array(n);
  for (let c = 0; c < n; c++) {
    if (K[c] === UNKNOWN && nb[c]!.some((d) => isNumber(K[d]!))) frontier[c] = 1;
  }
  const frontierMines: number[] = [];
  const interiorFree: number[] = [];
  const anyFree: number[] = [];
  const anyMines: number[] = [];
  for (let c = 0; c < n; c++) {
    if (zone.has(c)) continue;
    if (mines[c]) {
      anyMines.push(c);
      if (frontier[c]) frontierMines.push(c);
    } else {
      anyFree.push(c);
      if (K[c] === UNKNOWN && !frontier[c]) interiorFree.push(c);
    }
  }
  if (!anyFree.length || !anyMines.length) return;
  const src = frontierMines.length ? rng.pick(frontierMines) : rng.pick(anyMines);
  const dst = interiorFree.length ? rng.pick(interiorFree) : rng.pick(anyFree);
  mines[src] = 0;
  mines[dst] = 1;
}

/** Number of layouts consistent with `K` and the total, capped at `cap`. For small boards / tests. */
export function countCompletions(K: Int8Array, nb: number[][], total: number, cap = 2): number {
  const n = K.length;
  const cells: number[] = [];
  let known = 0;
  for (let c = 0; c < n; c++) {
    if (K[c] === UNKNOWN) cells.push(c);
    else if (K[c] === MINE) known++;
  }
  const assign = Int8Array.from(K);
  let found = 0;
  const consistent = (c: number): boolean => {
    for (const d of [c, ...nb[c]!]) {
      const v = K[d]!;
      if (!isNumber(v)) continue;
      let m = 0, u = 0;
      for (const e of nb[d]!) {
        if (assign[e] === MINE) m++;
        else if (assign[e] === UNKNOWN) u++;
      }
      if (m > v || m + u < v) return false;
    }
    return true;
  };
  for (let c = 0; c < n; c++) if (!consistent(c)) return 0;
  const rec = (i: number, placed: number): void => {
    if (found >= cap) return;
    const left = total - known - placed;
    if (left < 0 || left > cells.length - i) return;
    if (i === cells.length) { found++; return; }
    const c = cells[i]!;
    for (const v of [MINE, 10]) {
      assign[c] = v;
      if (consistent(c)) rec(i + 1, placed + (v === MINE ? 1 : 0));
    }
    assign[c] = UNKNOWN;
  };
  rec(0, 0);
  return found;
}
