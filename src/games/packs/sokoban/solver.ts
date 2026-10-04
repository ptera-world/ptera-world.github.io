import type { Rng } from "../../core/rng";
import type { GenerateContext } from "../../core/types";

export const FLOOR = 0, WALL = 1;

export interface SokoPuzzle {
  w: number;
  h: number;
  /** Row-major FLOOR or WALL. */
  cells: number[];
  /** Ascending. */
  goals: number[];
  /** Ascending. */
  boxes: number[];
  player: number;
}

/** Directions: 0 up, 1 right, 2 down, 3 left. */
export const DIR_NAMES = ["up", "right", "down", "left"] as const;
export const delta = (p: { w: number }, d: number): number => [-p.w, 1, p.w, -1][d]!;

/** The cell one step from c in direction d, or -1 off the board. */
export function stepFrom(p: { w: number; h: number }, c: number, d: number): number {
  const x = (c % p.w) + [0, 1, 0, -1][d]!, y = Math.floor(c / p.w) + [-1, 0, 1, 0][d]!;
  return x < 0 || y < 0 || x >= p.w || y >= p.h ? -1 : y * p.w + x;
}

export const isFloor = (p: SokoPuzzle, c: number): boolean => c >= 0 && p.cells[c] === FLOOR;

/** Cells the player can walk to from `from` without pushing (boxes block). */
export function walkable(p: SokoPuzzle, boxes: ReadonlySet<number>, from: number): Uint8Array {
  const seen = new Uint8Array(p.w * p.h);
  seen[from] = 1;
  const stack = [from];
  while (stack.length) {
    const c = stack.pop()!;
    for (let d = 0; d < 4; d++) {
      const n = stepFrom(p, c, d);
      if (n < 0 || seen[n] || p.cells[n] !== FLOOR || boxes.has(n)) continue;
      seen[n] = 1;
      stack.push(n);
    }
  }
  return seen;
}

/** A shortest walk (as directions) from `from` to `to` without pushing, or null. */
export function walkPath(p: SokoPuzzle, boxes: ReadonlySet<number>, from: number, to: number): number[] | null {
  if (from === to) return [];
  const prev = new Int32Array(p.w * p.h).fill(-1);
  const how = new Int8Array(p.w * p.h);
  prev[from] = from;
  const queue = [from];
  for (let i = 0; i < queue.length; i++) {
    const c = queue[i]!;
    for (let d = 0; d < 4; d++) {
      const n = stepFrom(p, c, d);
      if (n < 0 || prev[n] !== -1 || p.cells[n] !== FLOOR || boxes.has(n)) continue;
      prev[n] = c;
      how[n] = d;
      if (n === to) {
        const out: number[] = [];
        for (let k = to; k !== from; k = prev[k]!) out.push(how[k]!);
        return out.reverse();
      }
      queue.push(n);
    }
  }
  return null;
}

const liveCache = new WeakMap<SokoPuzzle, Uint8Array>();

/** Per cell, 1 if a box there could still be pushed onto some goal (ignoring the other boxes). */
export function liveCells(p: SokoPuzzle): Uint8Array {
  const hit = liveCache.get(p);
  if (hit) return hit;
  const live = new Uint8Array(p.w * p.h);
  const queue = [...p.goals];
  for (const g of queue) live[g] = 1;
  for (let i = 0; i < queue.length; i++) {
    const x = queue[i]!;
    for (let d = 0; d < 4; d++) {
      const from = stepFrom(p, x, d), stand = from < 0 ? -1 : stepFrom(p, from, d);
      if (!isFloor(p, from) || !isFloor(p, stand) || live[from]) continue;
      live[from] = 1;
      queue.push(from);
    }
  }
  liveCache.set(p, live);
  return live;
}

const blocked = (p: SokoPuzzle, boxes: ReadonlySet<number>, c: number) => c < 0 || p.cells[c] === WALL || boxes.has(c);

/**
 * A box that can never move again off a non-goal: on a cell from which no goal can be reached, or
 * part of a 2×2 block of walls and boxes that holds a box off its goal.
 */
export function stuckBoxes(p: SokoPuzzle, boxes: readonly number[]): number[] {
  const live = liveCells(p);
  const set = new Set(boxes);
  const goals = new Set(p.goals);
  const out = new Set<number>();
  for (const b of boxes) {
    if (!live[b]) { out.add(b); continue; }
    for (const [dx, dy] of [[0, 0], [-1, 0], [0, -1], [-1, -1]] as const) {
      const x = (b % p.w) + dx, y = Math.floor(b / p.w) + dy;
      if (x < 0 || y < 0 || x + 1 >= p.w || y + 1 >= p.h) continue;
      const square = [y * p.w + x, y * p.w + x + 1, (y + 1) * p.w + x, (y + 1) * p.w + x + 1];
      if (!square.every((c) => blocked(p, set, c))) continue;
      const inSquare = square.filter((c) => set.has(c));
      if (inSquare.some((c) => !goals.has(c))) for (const c of inSquare) if (!goals.has(c)) out.add(c);
    }
  }
  return [...out].sort((a, b) => a - b);
}

export const allHome = (p: SokoPuzzle, boxes: readonly number[]): boolean => {
  const goals = new Set(p.goals);
  return boxes.every((b) => goals.has(b));
};

// --- push search ---

/** Boxes (ascending) and the player's cell. */
export interface Spot {
  boxes: number[];
  player: number;
}

/** One push: the box at `box` moves one cell in `dir`, the player stepping in behind it. */
export interface Push {
  box: number;
  dir: number;
}

/** Per-puzzle tables and scratch buffers for searching positions. */
class Engine {
  readonly n: number;
  /** nbr[c*4+d]: the floor cell next to c in direction d, or -1. */
  readonly nbr: Int32Array;
  readonly live: Uint8Array;
  readonly goal: Uint8Array;
  readonly occ: Uint8Array;
  private readonly stack: Int32Array;
  private readonly marks = [new Uint32Array(0), new Uint32Array(0)];
  private ticks = [0, 0];

  constructor(readonly p: SokoPuzzle) {
    this.n = p.w * p.h;
    this.nbr = new Int32Array(this.n * 4).fill(-1);
    for (let c = 0; c < this.n; c++) {
      if (p.cells[c] !== FLOOR) continue;
      for (let d = 0; d < 4; d++) {
        const o = stepFrom(p, c, d);
        if (o >= 0 && p.cells[o] === FLOOR) this.nbr[c * 4 + d] = o;
      }
    }
    this.live = liveCells(p);
    this.goal = new Uint8Array(this.n);
    for (const g of p.goals) this.goal[g] = 1;
    this.occ = new Uint8Array(this.n);
    this.stack = new Int32Array(this.n);
    this.marks = [new Uint32Array(this.n), new Uint32Array(this.n)];
  }

  /** Flood from `from` over free floor into mark set `which`; returns the smallest cell reached. Read with reached(). */
  flood(from: number, which: 0 | 1): number {
    const mark = this.marks[which]!;
    const tick = ++this.ticks[which]!;
    let top = 0, min = from;
    mark[from] = tick;
    this.stack[top++] = from;
    while (top) {
      const c = this.stack[--top]!;
      if (c < min) min = c;
      for (let d = 0; d < 4; d++) {
        const o = this.nbr[c * 4 + d]!;
        if (o < 0 || this.occ[o] || mark[o] === tick) continue;
        mark[o] = tick;
        this.stack[top++] = o;
      }
    }
    return min;
  }

  reached(c: number, which: 0 | 1): boolean {
    return this.marks[which]![c] === this.ticks[which];
  }

  /** With `occ` set: the box at c is in a 2×2 block of walls and boxes holding a box off its goal. */
  frozen(c: number): boolean {
    const w = this.p.w;
    const solid = (x: number) => x < 0 || this.p.cells[x] !== FLOOR || this.occ[x] === 1;
    const x0 = c % w, y0 = Math.floor(c / w);
    for (const [dx, dy] of [[0, 0], [-1, 0], [0, -1], [-1, -1]] as const) {
      const x = x0 + dx, y = y0 + dy;
      if (x < 0 || y < 0 || x + 1 >= w || y + 1 >= this.p.h) continue;
      const sq = [y * w + x, y * w + x + 1, (y + 1) * w + x, (y + 1) * w + x + 1];
      if (sq.every(solid) && sq.some((s) => this.occ[s] === 1 && !this.goal[s])) return true;
    }
    return false;
  }
}

const engines = new WeakMap<SokoPuzzle, Engine>();
const engineOf = (p: SokoPuzzle) => {
  let e = engines.get(p);
  if (!e) engines.set(p, (e = new Engine(p)));
  return e;
};

interface Explored {
  /** Box cells of state i are flat[i*k … i*k+k-1]. */
  flat: number[];
  player: number[];
  dist: number[];
  parent: number[];
  /** box * 4 + dir of the push or pull that reached each state (-1 for starts). */
  move: number[];
  found: number;
  complete: boolean;
}

/**
 * Positions reachable from `starts` by pushes (or, with `pull`, by pulls), level by level, keyed by
 * boxes plus the player's smallest reachable cell. Stops at the first state `goal` accepts, or
 * after `limit` states.
 */
function explore(p: SokoPuzzle, starts: readonly Spot[], pull: boolean, limit: number, goal?: (e: Engine, i: number, x: Explored) => boolean): Explored {
  const e = engineOf(p);
  const k = starts[0]?.boxes.length ?? 0;
  const x: Explored = { flat: [], player: [], dist: [], parent: [], move: [], found: -1, complete: true };
  const index = new Map<string, number>();
  const child = new Int32Array(k);
  const add = (boxes: ArrayLike<number>, player: number, min: number, dist: number, parent: number, move: number): number => {
    let key = String.fromCharCode(min);
    for (let i = 0; i < k; i++) key += String.fromCharCode(boxes[i]!);
    if (index.has(key)) return -1;
    const id = x.dist.length;
    index.set(key, id);
    for (let i = 0; i < k; i++) x.flat.push(boxes[i]!);
    x.player.push(player);
    x.dist.push(dist);
    x.parent.push(parent);
    x.move.push(move);
    return id;
  };
  const setOcc = (id: number, v: number) => { for (let i = 0; i < k; i++) e.occ[x.flat[id * k + i]!] = v; };
  for (const s of starts) {
    const sorted = s.boxes.slice().sort((a, b) => a - b);
    for (const b of sorted) e.occ[b] = 1;
    const min = e.flood(s.player, 1);
    for (const b of sorted) e.occ[b] = 0;
    const id = add(sorted, s.player, min, 0, -1, -1);
    if (id >= 0 && goal?.(e, id, x)) { x.found = id; x.complete = false; return x; }
  }
  for (let id = 0; id < x.dist.length; id++) {
    setOcc(id, 1);
    e.flood(x.player[id]!, 0);
    for (let i = 0; i < k; i++) {
      const b = x.flat[id * k + i]!;
      for (let d = 0; d < 4; d++) {
        let stand: number, to: number, player: number;
        if (pull) {
          to = e.nbr[b * 4 + d]!;
          player = to < 0 ? -1 : e.nbr[to * 4 + d]!;
          stand = to;
          if (to < 0 || player < 0 || !e.reached(stand, 0) || e.occ[player]) continue;
        } else {
          stand = e.nbr[b * 4 + ((d + 2) % 4)]!;
          to = e.nbr[b * 4 + d]!;
          player = b;
          if (stand < 0 || to < 0 || !e.reached(stand, 0) || e.occ[to] || !e.live[to]) continue;
        }
        e.occ[b] = 0;
        e.occ[to] = 1;
        if (!pull && e.frozen(to)) { e.occ[to] = 0; e.occ[b] = 1; continue; }
        const min = e.flood(player, 1);
        let j = 0;
        for (let t = 0; t < k; t++) {
          const v = t === i ? to : x.flat[id * k + t]!;
          let pos = j++;
          while (pos > 0 && child[pos - 1]! > v) { child[pos] = child[pos - 1]!; pos--; }
          child[pos] = v;
        }
        e.occ[to] = 0;
        e.occ[b] = 1;
        if (x.dist.length >= limit) { setOcc(id, 0); x.complete = false; return x; }
        const nid = add(child, player, min, x.dist[id]! + 1, id, (pull ? to : b) * 4 + (pull ? (d + 2) % 4 : d));
        if (nid >= 0 && goal?.(e, nid, x)) { setOcc(id, 0); x.found = nid; x.complete = false; return x; }
      }
    }
    setOcc(id, 0);
  }
  return x;
}

const boxesOf = (x: Explored, id: number, k: number) => x.flat.slice(id * k, id * k + k);
const homeAt = (e: Engine, x: Explored, id: number, k: number) => {
  for (let i = 0; i < k; i++) if (!e.goal[x.flat[id * k + i]!]) return false;
  return true;
};

export const SEARCH_LIMIT = 300_000;

/** Fewest pushes from a spot to every box home: the pushes, or null if there is none; `gaveUp` when the search hit its limit. */
export function solvePushes(p: SokoPuzzle, from: Spot, limit = SEARCH_LIMIT): { pushes: Push[] | null; gaveUp: boolean } {
  const k = from.boxes.length;
  const x = explore(p, [from], false, limit, (e, id, xx) => homeAt(e, xx, id, k));
  if (x.found < 0) return { pushes: null, gaveUp: !x.complete };
  const out: Push[] = [];
  for (let id = x.found; x.parent[id]! >= 0; id = x.parent[id]!) out.push({ box: x.move[id]! >> 2, dir: x.move[id]! & 3 });
  return { pushes: out.reverse(), gaveUp: false };
}

// --- generation ---

/** Random walls inside a border, keeping the floor in one piece; null if too little floor is left. */
function randomRoom(w: number, h: number, rng: Rng): number[] | null {
  const W = w + 2, H = h + 2;
  const cells = Array.from({ length: W * H }, (_, c) => {
    const x = c % W, y = Math.floor(c / W);
    return x === 0 || y === 0 || x === W - 1 || y === H - 1 ? WALL : FLOOR;
  });
  const blobs = Math.round((w * h) / 9);
  for (let i = 0; i < blobs; i++) {
    const x = rng.range(1, w), y = rng.range(1, h);
    const shape = rng.pick([[[0, 0]], [[0, 0], [1, 0]], [[0, 0], [0, 1]], [[0, 0], [1, 0], [0, 1]], [[0, 0], [1, 0], [1, 1]]] as const);
    for (const [dx, dy] of shape) {
      const xx = x + dx, yy = y + dy;
      if (xx >= 1 && yy >= 1 && xx <= w && yy <= h) cells[yy * W + xx] = WALL;
    }
  }
  const start = cells.indexOf(FLOOR);
  if (start < 0) return null;
  const room = { w: W, h: H, cells, goals: [], boxes: [], player: start } satisfies SokoPuzzle;
  const reach = walkable(room, new Set(), start);
  let floor = 0;
  for (let c = 0; c < cells.length; c++) {
    if (cells[c] === FLOOR && !reach[c]) cells[c] = WALL;
    if (cells[c] === FLOOR) floor++;
  }
  return floor >= w * h * 0.55 ? cells : null;
}

/**
 * A random room with goals; every box starts on a goal and is pulled backwards as far as it goes.
 * The start is the first-found position needing the most pushes, so it is always solvable and
 * needs exactly that many pushes.
 */
export async function generatePuzzle(o: { w: number; h: number; boxes: number }, rng: Rng, ctx: GenerateContext): Promise<SokoPuzzle> {
  let best: { p: SokoPuzzle; d: number } | null = null;
  const k = o.boxes;
  for (let attempt = 0; ; attempt++) {
    await ctx.yield();
    const cells = randomRoom(o.w, o.h, rng);
    if (!cells) continue;
    const W = o.w + 2, H = o.h + 2;
    const floor = cells.flatMap((v, c) => (v === FLOOR ? [c] : []));
    if (floor.length < k + 3) continue;
    const goals = rng.shuffle(floor.slice()).slice(0, k).sort((a, b) => a - b);
    const room: SokoPuzzle = { w: W, h: H, cells, goals, boxes: goals, player: -1 };
    const set = new Set(goals);
    const starts: Spot[] = [];
    const covered = new Uint8Array(W * H);
    for (const c of floor) {
      if (set.has(c) || covered[c]) continue;
      walkable(room, set, c).forEach((v, i) => { if (v) covered[i] = 1; });
      starts.push({ boxes: goals, player: c });
    }
    await ctx.yield();
    const x = explore(room, starts, true, 80_000);
    const e = engineOf(room);
    let far = 0, farId = -1;
    for (let id = 0; id < x.dist.length; id++) if (x.dist[id]! > far && !homeAt(e, x, id, k)) { far = x.dist[id]!; farId = id; }
    if (farId < 0) continue;
    const p: SokoPuzzle = { w: W, h: H, cells, goals, boxes: boxesOf(x, farId, k), player: x.player[farId]! };
    if (far >= k * 5) return p;
    if (!best || far > best.d) best = { p, d: far };
    if (attempt >= 10) return best.p;
  }
}

/** Fewest pushes moving one box from its cell to `target` with every other box left where it is, or null. */
export function boxRoute(p: SokoPuzzle, boxes: readonly number[], player: number, box: number, target: number): Push[] | null {
  if (box === target) return [];
  const others = new Set(boxes.filter((b) => b !== box));
  const seen = new Map<string, { from: string | null; push: Push | null }>();
  const keyOf = (b: number, pl: number) => {
    const set = new Set(others).add(b);
    return `${b}|${walkable(p, set, pl).indexOf(1)}`;
  };
  const start = { b: box, pl: player, k: keyOf(box, player) };
  seen.set(start.k, { from: null, push: null });
  const queue = [start];
  for (let i = 0; i < queue.length; i++) {
    const { b, pl, k } = queue[i]!;
    const set = new Set(others).add(b);
    const reach = walkable(p, set, pl);
    for (let d = 0; d < 4; d++) {
      const stand = stepFrom(p, b, (d + 2) % 4), to = stepFrom(p, b, d);
      if (stand < 0 || !reach[stand] || !isFloor(p, to) || others.has(to)) continue;
      const nk = keyOf(to, b);
      if (seen.has(nk)) continue;
      seen.set(nk, { from: k, push: { box: b, dir: d } });
      if (to === target) {
        const out: Push[] = [];
        for (let cur: string | null = nk; cur;) {
          const e: { from: string | null; push: Push | null } = seen.get(cur)!;
          if (e.push) out.push(e.push);
          cur = e.from;
        }
        return out.reverse();
      }
      queue.push({ b: to, pl: b, k: nk });
    }
  }
  return null;
}
