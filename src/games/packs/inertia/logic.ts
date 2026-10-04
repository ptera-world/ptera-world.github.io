import { cellName as cellAt } from "../../lib/grid-kit/names";
import type { Rng } from "../../core/rng";
import { defineSchema, type Values } from "../../core/schema";
import type { Format, GenerateContext, PuzzleDef, Rating } from "../../core/types";

export const BLANK = 0, GEM = 1, MINE = 2, STOP = 3, WALL = 4;

export const params = defineSchema({
  width: { type: "int", label: "width", default: 10, min: 3, max: 30 },
  height: { type: "int", label: "height", default: 8, min: 3, max: 30 },
});

export interface InertiaPuzzle {
  w: number;
  h: number;
  /** Row-major cell kinds: BLANK, GEM, MINE, STOP, WALL. The start is a STOP. */
  grid: number[];
  start: number;
}

export interface InertiaState {
  pos: number;
  /** 1 where a gem is still waiting, per cell. */
  gems: number[];
  dead: boolean;
  moves: number;
}

/** Roll in one of eight directions: 0 up, then clockwise to 7 up-left. */
export type InertiaAction = { type: "move"; dir: number };

export interface InertiaFocus {
  /** Cells the ball rolls over in the hinted move, ending where it stops. */
  path?: number[];
  /** Gems the hint is about. */
  gems?: number[];
}

export interface InertiaInteraction {
  /** Direction the pointer is aiming, or -1. */
  aim: number;
}

export const DX = [0, 1, 1, 1, 0, -1, -1, -1] as const;
export const DY = [-1, -1, 0, 1, 1, 1, 0, -1] as const;
export const DIR_NAMES = ["up", "up-right", "right", "down-right", "down", "down-left", "left", "up-left"] as const;

export { cellAt };

const kind = (p: Pick<InertiaPuzzle, "w" | "h" | "grid">, x: number, y: number) => (x < 0 || y < 0 || x >= p.w || y >= p.h ? WALL : p.grid[y * p.w + x]!);

export interface Roll {
  /** Cells entered, in order; the last is where the ball ends up. Empty if a wall is in the way. */
  path: number[];
  dead: boolean;
}

/** Where a roll from `pos` goes: gems don't stop it, a stop or a wall ahead does, a mine ends it. */
export function roll(p: Pick<InertiaPuzzle, "w" | "h" | "grid">, pos: number, dir: number): Roll {
  let x = pos % p.w, y = Math.floor(pos / p.w);
  const path: number[] = [];
  for (;;) {
    if (kind(p, x + DX[dir]!, y + DY[dir]!) === WALL) return { path, dead: false };
    x += DX[dir]!;
    y += DY[dir]!;
    path.push(y * p.w + x);
    const k = kind(p, x, y);
    if (k === MINE) return { path, dead: true };
    if (k === STOP) return { path, dead: false };
  }
}

// --- reachability: which gems can still be collected ---

interface Graph {
  nodes: number[];
  edges: { to: number; cells: number[] }[][];
}

/** Every resting place reachable from `from` without dying, with the safe rolls between them. */
function graphFrom(p: InertiaPuzzle, from: number): Graph {
  const index = new Map<number, number>([[from, 0]]);
  const nodes = [from];
  const edges: { to: number; cells: number[] }[][] = [];
  for (let i = 0; i < nodes.length; i++) {
    const out: { to: number; cells: number[] }[] = [];
    for (let d = 0; d < 8; d++) {
      const r = roll(p, nodes[i]!, d);
      if (!r.path.length || r.dead) continue;
      const end = r.path[r.path.length - 1]!;
      if (!index.has(end)) { index.set(end, nodes.length); nodes.push(end); }
      out.push({ to: index.get(end)!, cells: r.path });
    }
    edges.push(out);
  }
  return { nodes, edges };
}

const SEARCH_LIMIT = 20_000;

interface Parts {
  /** Part (strongly connected set of resting places) holding the starting place. */
  root: number;
  /** Cells passed by rolls that stay inside each part. */
  inside: Set<number>[];
  /** Rolls leading from each part to a later one, with the cells they pass. */
  out: { to: number; cells: number[] }[][];
  /** Every cell any reachable roll passes. */
  passable: Set<number>;
}

const partsCache = new WeakMap<InertiaPuzzle, Map<number, Parts>>();

/** The move graph from `pos`, split into strongly connected parts (cached per puzzle and place). */
function parts(p: InertiaPuzzle, pos: number): Parts {
  let byPos = partsCache.get(p);
  if (!byPos) partsCache.set(p, (byPos = new Map()));
  const hit = byPos.get(pos);
  if (hit) return hit;
  const g = graphFrom(p, pos);
  const n = g.nodes.length;
  const comp = new Int32Array(n).fill(-1);
  const low = new Int32Array(n), num = new Int32Array(n).fill(-1);
  const stack: number[] = [], on = new Uint8Array(n);
  let counter = 0, comps = 0;
  for (let v0 = 0; v0 < n; v0++) {
    if (num[v0] !== -1) continue;
    const work: [number, number][] = [[v0, 0]];
    num[v0] = low[v0] = counter++;
    stack.push(v0); on[v0] = 1;
    while (work.length) {
      const top = work[work.length - 1]!;
      const [u, k] = top;
      const es = g.edges[u]!;
      if (k < es.length) {
        top[1]++;
        const w = es[k]!.to;
        if (num[w] === -1) { num[w] = low[w] = counter++; stack.push(w); on[w] = 1; work.push([w, 0]); }
        else if (on[w]) low[u] = Math.min(low[u]!, num[w]!);
      } else {
        work.pop();
        if (work.length) { const parent = work[work.length - 1]![0]; low[parent] = Math.min(low[parent]!, low[u]!); }
        if (low[u] === num[u]) {
          let x: number;
          do { x = stack.pop()!; on[x] = 0; comp[x] = comps; } while (x !== u);
          comps++;
        }
      }
    }
  }
  const inside: Set<number>[] = Array.from({ length: comps }, () => new Set());
  const out: { to: number; cells: number[] }[][] = Array.from({ length: comps }, () => []);
  const passable = new Set<number>();
  g.edges.forEach((es, u) => {
    for (const e of es) {
      for (const c of e.cells) passable.add(c);
      const a = comp[u]!, b = comp[e.to]!;
      if (a === b) for (const c of e.cells) inside[a]!.add(c);
      else out[a]!.push({ to: b, cells: e.cells });
    }
  });
  const r = { root: comp[0]!, inside, out, passable };
  byPos.set(pos, r);
  return r;
}

/**
 * True if one walk from `pos` can pass over every gem left. Rolls inside a strongly connected
 * part of the move graph can be repeated freely; between parts the walk is a path, so this
 * searches paths through the parts. Gives the benefit of the doubt if the search runs long.
 */
export function canCollectAll(p: InertiaPuzzle, pos: number, gems: readonly number[]): boolean {
  const want = gems.flatMap((g, c) => (g ? [c] : []));
  if (!want.length) return true;
  const { root, inside, out, passable } = parts(p, pos);
  if (want.some((c) => !passable.has(c))) return false;
  let steps = 0;
  const seen = new Set<string>();
  const go = (a: number, need: number[]): boolean => {
    const left = need.filter((c) => !inside[a]!.has(c));
    if (!left.length) return true;
    const key = `${a}|${left.join(",")}`;
    if (seen.has(key)) return false;
    seen.add(key);
    if (++steps > SEARCH_LIMIT) return true;
    for (const e of out[a]!) if (go(e.to, left.filter((c) => !e.cells.includes(c)))) return true;
    return false;
  };
  return go(root, want);
}

/** Gems no roll from `pos` can ever pass over. */
export function unreachableGems(p: InertiaPuzzle, pos: number, gems: readonly number[]): number[] {
  const { passable } = parts(p, pos);
  return gems.flatMap((v, c) => (v && !passable.has(c) ? [c] : []));
}

export interface Route {
  /** Directions to roll, reaching the next gem. */
  dirs: number[];
  /** Cells passed on each roll. */
  paths: number[][];
  /** Gems picked up on the last roll. */
  gems: number[];
}

/**
 * Fewest rolls to pick up at least one more gem while every remaining gem stays collectable,
 * resting only where that's still true; null if no such route exists.
 */
export function nextGemRoute(p: InertiaPuzzle, s: Pick<InertiaState, "pos" | "gems">): Route | null {
  const good = new Map<number, boolean>();
  const isGood = (pos: number) => {
    let v = good.get(pos);
    if (v === undefined) good.set(pos, (v = canCollectAll(p, pos, s.gems)));
    return v;
  };
  const prev = new Map<number, { from: number; dir: number; path: number[] } | null>([[s.pos, null]]);
  let frontier = [s.pos];
  while (frontier.length) {
    const next: number[] = [];
    for (const u of frontier) {
      for (let d = 0; d < 8; d++) {
        const r = roll(p, u, d);
        if (!r.path.length || r.dead) continue;
        const end = r.path[r.path.length - 1]!;
        const got = [...new Set(r.path.filter((c) => s.gems[c]))];
        if (got.length) {
          const left = s.gems.slice();
          for (const c of got) left[c] = 0;
          if (!canCollectAll(p, end, left)) continue;
          const dirs = [d], paths = [r.path];
          for (let e = prev.get(u); e; e = prev.get(e.from)) { dirs.unshift(e.dir); paths.unshift(e.path); }
          return { dirs, paths, gems: got };
        }
        if (prev.has(end) || !isGood(end)) continue;
        prev.set(end, { from: u, dir: d, path: r.path });
        next.push(end);
      }
    }
    frontier = next;
  }
  return null;
}

/** Rolls the hint method takes to collect everything from the start, or null if it can't. */
export function greedyRolls(p: InertiaPuzzle): number | null {
  let s: InertiaState = { pos: p.start, gems: p.grid.map((k) => (k === GEM ? 1 : 0)), dead: false, moves: 0 };
  let n = 0;
  while (s.gems.some(Boolean)) {
    const r = nextGemRoute(p, s);
    if (!r) return null;
    for (const d of r.dirs) s = move(p, s, d);
    n += r.dirs.length;
  }
  return n;
}

export function move(p: InertiaPuzzle, s: InertiaState, dir: number): InertiaState {
  if (s.dead || !Number.isInteger(dir) || dir < 0 || dir > 7) return s;
  const r = roll(p, s.pos, dir);
  if (!r.path.length) return s;
  let gems = s.gems;
  for (const c of r.path) {
    if (gems[c]) {
      if (gems === s.gems) gems = gems.slice();
      gems[c] = 0;
    }
  }
  return { pos: r.path[r.path.length - 1]!, gems, dead: r.dead, moves: s.moves + 1 };
}

// --- generation ---

/** Cells some roll passes over on a loop that starts and ends at the start (so gems there can always be fetched). */
function gemCandidates(p: InertiaPuzzle): number[] {
  const n = p.w * p.h;
  const passes = (forward: boolean): Uint8Array => {
    const seen = new Uint8Array(n * 8);
    const queue: number[] = [];
    for (let d = 0; d < 8; d++) { seen[p.start * 8 + d] = 1; queue.push(p.start * 8 + d); }
    const canGo = (x1: number, y1: number, d1: number, x2: number, y2: number, d2: number): boolean => {
      const k1 = kind(p, x1, y1);
      if (k1 === WALL || k1 === MINE) return false;
      if (x1 === x2 && y1 === y2 && (k1 === STOP || kind(p, x1 + DX[d1]!, y1 + DY[d1]!) === WALL)) return true;
      if (x2 === x1 + DX[d1]! && y2 === y1 + DY[d1]! && d1 === d2) {
        const k2 = kind(p, x2, y2);
        return k2 === BLANK || k2 === GEM || k2 === STOP;
      }
      return false;
    };
    while (queue.length) {
      const id = queue.shift()!;
      const d = id % 8, c = Math.floor(id / 8), x = c % p.w, y = Math.floor(c / p.w);
      const sign = forward ? 1 : -1;
      for (let k = -1; k < 8; k++) {
        const x2 = k < 0 ? x + sign * DX[d]! : x, y2 = k < 0 ? y + sign * DY[d]! : y, d2 = k < 0 ? d : k;
        if (x2 < 0 || y2 < 0 || x2 >= p.w || y2 >= p.h) continue;
        const id2 = (y2 * p.w + x2) * 8 + d2;
        if (seen[id2]) continue;
        if (forward ? canGo(x, y, d, x2, y2, d2) : canGo(x2, y2, d2, x, y, d)) { seen[id2] = 1; queue.push(id2); }
      }
    }
    return seen;
  };
  const from = passes(true), to = passes(false);
  const out: number[] = [];
  for (let c = 0; c < n; c++) {
    if (p.grid[c] !== BLANK) continue;
    for (let d = 0; d < 8; d++) if (from[c * 8 + d] && to[c * 8 + d]) { out.push(c); break; }
  }
  return out;
}

async function generate(v: Values<typeof params>, rng: Rng, ctx: GenerateContext): Promise<InertiaPuzzle> {
  const w = v.width, h = v.height, n = w * h, fifth = Math.floor(n / 5);
  let threshold = 2, tries = 0;
  for (;;) {
    const grid: number[] = [];
    for (let i = 0; i < fifth; i++) grid.push(WALL);
    for (let i = 0; i < fifth; i++) grid.push(STOP);
    for (let i = 0; i < fifth; i++) grid.push(MINE);
    const startAt = grid.length;
    grid.push(STOP);
    while (grid.length < n) grid.push(BLANK);
    const order = rng.shuffle(Array.from({ length: n }, (_, i) => i));
    const placed = order.map((i) => grid[i]!);
    const start = order.indexOf(startAt);
    const p: InertiaPuzzle = { w, h, grid: placed, start };
    const cand = gemCandidates(p);
    if (tries % 20 === 19) await ctx.yield();
    if (cand.length < fifth || !cand.length) { tries++; continue; }
    const dist = new Int32Array(n).fill(-1);
    const queue = [...cand];
    for (const c of cand) dist[c] = 0;
    let far = 0;
    for (let i = 0; i < queue.length; i++) {
      const c = queue[i]!;
      far = Math.max(far, dist[c]!);
      const x = c % w, y = Math.floor(c / w);
      for (let d = 0; d < 8; d++) {
        const x2 = x + DX[d]!, y2 = y + DY[d]!;
        if (x2 < 0 || y2 < 0 || x2 >= w || y2 >= h) continue;
        const c2 = y2 * w + x2;
        if (dist[c2] === -1) { dist[c2] = dist[c]! + 1; queue.push(c2); }
      }
    }
    if (far > threshold) {
      if (++tries % 50 === 0) threshold++;
      continue;
    }
    for (const c of rng.shuffle(cand).slice(0, Math.max(1, fifth))) p.grid[c] = GEM;
    return p;
  }
}

// --- formats ---

const CHARS = "bgmsw";

function checked(w: number, h: number, cells: string): InertiaPuzzle {
  if (!(w >= 1 && h >= 1 && w <= 60 && h <= 60)) throw new Error("size out of range");
  if (cells.length !== w * h) throw new Error(`expected ${w * h} cells, got ${cells.length}`);
  const starts = [...cells].flatMap((ch, i) => (ch === "S" ? [i] : []));
  if (starts.length !== 1) throw new Error(starts.length ? "more than one start" : "no start (S)");
  const grid = [...cells].map((ch) => (ch === "S" ? STOP : CHARS.indexOf(ch)));
  if (grid.some((k) => k < 0)) throw new Error("cells must be b, g, m, s, w or S");
  if (!grid.includes(GEM)) throw new Error("no gems (g)");
  return { w, h, grid, start: starts[0]! };
}

const SGT_RE = /^(\d+)(?:x(\d+))?:([bgmswS]+)$/;

/** Simon Tatham's Inertia game id: `WxH:` then b (blank), g (gem), m (mine), s (stop), w (wall) or S (start) per cell. */
export const sgtFormat: Format<InertiaPuzzle> = {
  id: "sgt",
  label: "sgt game id (WxH:bgmswS…)",
  detect: (t) => SGT_RE.test(t.trim()),
  parse(text) {
    const m = SGT_RE.exec(text.trim());
    if (!m) throw new Error("expected WxH:… using b g m s w S");
    return checked(Number(m[1]), Number(m[2] ?? m[1]), m[3]!);
  },
  serialize: (p) => `${p.w}x${p.h}:${p.grid.map((k, i) => (i === p.start ? "S" : CHARS[k])).join("")}`,
};

/** One row per line: `.` blank, `*` gem, `x` mine, `o` stop, `#` wall, `@` start. */
export const gridFormat: Format<InertiaPuzzle> = {
  id: "grid",
  label: "grid (. * x o # @)",
  detect: (t) => t.trim().includes("\n") && /^[.*xo#@\s]+$/.test(t.trim()),
  parse(text) {
    const rows = text.trim().split(/\r?\n/).map((r) => r.trim()).filter(Boolean);
    const w = rows[0]?.length ?? 0;
    if (rows.some((r) => r.length !== w)) throw new Error("rows have different lengths");
    const map: Record<string, string> = { ".": "b", "*": "g", x: "m", o: "s", "#": "w", "@": "S" };
    return checked(w, rows.length, rows.join("").split("").map((c) => map[c] ?? "?").join(""));
  },
  serialize(p) {
    const ch = (k: number, i: number) => (i === p.start ? "@" : ".*xo#"[k]!);
    const rows: string[] = [];
    for (let y = 0; y < p.h; y++) rows.push(p.grid.slice(y * p.w, y * p.w + p.w).map((k, x) => ch(k, y * p.w + x)).join(""));
    return rows.join("\n");
  },
};

const ratingCache = new WeakMap<InertiaPuzzle, Rating | null>();
function rate(p: InertiaPuzzle): Rating | null {
  if (ratingCache.has(p)) return ratingCache.get(p)!;
  const n = greedyRolls(p);
  const r = n === null ? null : { label: `${n} rolls`, score: n };
  ratingCache.set(p, r);
  return r;
}

export const gemCount = (gems: readonly number[]) => gems.reduce((a, b) => a + b, 0);

export const inertia: PuzzleDef<InertiaPuzzle, InertiaState, InertiaAction, InertiaInteraction, typeof params> = {
  id: "inertia",
  name: "inertia",
  aliases: ["inertia", "gem collecting", "ice sliding"],
  tags: ["moves", "maze", "sliding"],
  description: "roll a ball round a grid collecting every gem. once rolling, it only stops at a stop square or a wall, and mines are deadly.",
  generatorVersion: 1,
  params,
  presets: [
    { label: "10×8", params: { width: 10, height: 8 } },
    { label: "15×12", params: { width: 15, height: 12 } },
    { label: "20×16", params: { width: 20, height: 16 } },
  ],
  generate,
  formats: [sgtFormat, gridFormat],
  init: (p) => ({ pos: p.start, gems: p.grid.map((k) => (k === GEM ? 1 : 0)), dead: false, moves: 0 }),
  initInteraction: () => ({ aim: -1 }),
  reduce(p, s, a) {
    if (a.type !== "move") return s;
    return move(p, s, a.dir);
  },
  isSolved: (_p, s) => !s.dead && !s.gems.some(Boolean),
  isLost: (_p, s) => (s.dead ? { focus: { path: [s.pos] } satisfies InertiaFocus } : false),
  rate,
  rules: () => [
    "the ball rolls in any of eight directions (diagonals too) and keeps going until a stop square or a wall (the edge counts) halts it.",
    "gems are collected by rolling over them; they don't stop the ball.",
    "rolling onto a mine ends the game (undo steps back).",
    "collect every gem.",
  ],
  describe: (p) => `${p.w}×${p.h} · ${gemCount(p.grid.map((k) => (k === GEM ? 1 : 0)))} gems`,
};
