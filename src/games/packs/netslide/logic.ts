import { colName, rowName } from "../../core/names";
import type { Rng } from "../../core/rng";
import { defineSchema, type Values } from "../../core/schema";
import type { Format, PuzzleDef, Rating } from "../../core/types";
import { D, DIRS, L, R, U, centre, connected, degree, neighbour, normalizeBarriers, opp, type Geometry } from "./grid";
import { nextStep, solveAll, type PermMove, type PermSpec, type PermStep } from "../../lib/perm";

export const params = defineSchema({
  width: { type: "int", label: "width", default: 4, min: 3, max: 7 },
  height: { type: "int", label: "height", default: 4, min: 3, max: 7 },
  wrap: { type: "bool", label: "wrapping", default: false, description: "pipes may run off one edge and come back on the opposite one" },
  barriers: {
    type: "int", label: "barriers (% of unused edges)", default: 100, min: 0, max: 100,
    description: "walls on edges the solution doesn't use; more walls make it easier",
  },
  shuffle: { type: "int", label: "scramble slides (0 = standard)", default: 0, min: 0, max: 500 },
});

export interface NetslidePuzzle extends Geometry {
  /** Pipe masks, row-major, as the board starts. */
  tiles: number[];
  /** Blocked sides per cell, recorded on both cells they separate. */
  barriers: number[];
  /** A finished arrangement, when known (generated boards). */
  solution?: number[];
}

export interface NetslideState {
  tiles: number[];
  moves: number;
}

/** Slide a row (positive = right) or column (positive = down) round. The center row and column never move. */
export type NetslideAction = { type: "shift"; line: "row" | "col"; index: number; by: number };

export interface NetslideFocus {
  moving?: number[];
  home?: number;
  tile?: number;
}

export interface NetslideInteraction {
  cursor: number;
}

export function shift(w: number, h: number, tiles: readonly number[], a: NetslideAction): number[] {
  const out = tiles.slice();
  if (a.line === "row") {
    for (let x = 0; x < w; x++) out[a.index * w + ((((x + a.by) % w) + w) % w)] = tiles[a.index * w + x]!;
  } else {
    for (let y = 0; y < h; y++) out[((((y + a.by) % h) + h) % h) * w + a.index] = tiles[y * w + a.index]!;
  }
  return out;
}

export function movable(p: Pick<NetslidePuzzle, "w" | "h">, a: Pick<NetslideAction, "line" | "index">): boolean {
  const c = centre(p);
  return a.line === "row" ? a.index >= 0 && a.index < p.h && a.index !== Math.floor(c / p.w) : a.index >= 0 && a.index < p.w && a.index !== c % p.w;
}

export const isSolvedTiles = (p: NetslidePuzzle, tiles: readonly number[]): boolean => connected(p, p.barriers, tiles).every(Boolean);

// --- generation ---

/** A random spanning tree grown from the center with no four-way crossings. */
function growTree(g: Geometry, rng: Rng): number[] {
  const n = g.w * g.h;
  const tiles = Array.from({ length: n }, () => 0);
  type Poss = { i: number; d: number };
  let poss: Poss[] = [];
  const start = centre(g);
  for (const d of DIRS) if (neighbour({ ...g, wrap: false }, start, d) >= 0) poss.push({ i: start, d });
  while (poss.length) {
    const { i, d } = poss.splice(rng.int(poss.length), 1)[0]!;
    const j = neighbour(g, i, d);
    tiles[i]! |= d;
    tiles[j]! |= opp(d);
    if (degree(tiles[i]!) === 3) poss = poss.filter((q) => !(q.i === i && q.d === (15 ^ tiles[i]!)));
    poss = poss.filter((q) => neighbour(g, q.i, q.d) !== j);
    for (const e of DIRS) {
      if (e === opp(d)) continue;
      const k = neighbour(g, j, e);
      if (k < 0 || k === j || tiles[k]) continue;
      poss.push({ i: j, d: e });
    }
  }
  return tiles;
}

function generate(v: Values<typeof params>, rng: Rng): NetslidePuzzle {
  const g: Geometry = { w: v.width, h: v.height, wrap: v.wrap };
  const solution = growTree(g, rng.fork("tree"));
  const c = centre(g), cx = c % g.w, cy = Math.floor(c / g.w);
  const total = v.shuffle || (g.w - 1) * (g.h - 1) * 2;
  const mix = rng.fork("shuffle");
  let tiles = solution;
  for (let attempt = 0; attempt < 20; attempt++) {
    tiles = solution;
    let prev: NetslideAction | null = null, repeats = 0;
    for (let i = 0; i < total;) {
      const col = mix.bool();
      let index = mix.int(col ? g.w - 1 : g.h - 1);
      if (index >= (col ? cx : cy)) index++;
      const a: NetslideAction = { type: "shift", line: col ? "col" : "row", index, by: mix.bool() ? 1 : -1 };
      const len = col ? g.h : g.w;
      if (prev && prev.line === a.line && prev.index === a.index) {
        if (prev.by === -a.by) continue;
        if ((repeats + 1) * 2 > len) continue;
      }
      repeats = prev && prev.line === a.line && prev.index === a.index ? repeats + 1 : 1;
      tiles = shift(g.w, g.h, tiles, a);
      prev = a;
      i++;
    }
    if (!connected(g, solution.map(() => 0), tiles).every(Boolean)) break;
  }
  const edges: { i: number; d: number }[] = [];
  for (let i = 0; i < g.w * g.h; i++) {
    for (const d of [R, D]) {
      if (solution[i]! & d) continue;
      if (neighbour(g, i, d) < 0) continue;
      edges.push({ i, d });
    }
  }
  const bar = rng.fork("barriers");
  bar.shuffle(edges);
  const raw = Array.from({ length: g.w * g.h }, () => 0);
  for (const { i, d } of edges.slice(0, Math.floor((v.barriers / 100) * edges.length))) raw[i]! |= d;
  const barriers = normalizeBarriers(g, raw);
  const p: NetslidePuzzle = { ...g, tiles, barriers, solution };
  if (isSolvedTiles(p, tiles)) {
    const row = cy === 0 ? 1 : 0;
    p.tiles = shift(g.w, g.h, tiles, { type: "shift", line: "row", index: row, by: 1 });
  }
  return p;
}

// --- finding an arrangement for boards that don't carry one ---

const NODE_BUDGET = 400_000;

/** Some finished arrangement of the board's own tiles (the center stays put), or null if none is found. */
export function findArrangement(p: NetslidePuzzle): number[] | null {
  const n = p.w * p.h;
  const c0 = centre(p);
  const counts = new Map<number, number>();
  p.tiles.forEach((t, i) => { if (i !== c0) counts.set(t, (counts.get(t) ?? 0) + 1); });
  const types = [...counts.keys()];
  const order: number[] = [c0];
  const seen = new Uint8Array(n);
  seen[c0] = 1;
  for (let k = 0; k < order.length; k++) {
    for (const d of DIRS) {
      const j = neighbour(p, order[k]!, d);
      if (j >= 0 && !seen[j]) { seen[j] = 1; order.push(j); }
    }
  }
  const out = Array.from({ length: n }, () => -1);
  out[c0] = p.tiles[c0]!;
  let nodes = 0;
  const fits = (i: number, t: number): boolean => {
    for (const d of DIRS) {
      const has = (t & d) !== 0;
      const j = neighbour(p, i, d);
      if (j < 0 || p.barriers[i]! & d) { if (has) return false; continue; }
      const other = out[j]!;
      if (other >= 0 && has !== ((other & opp(d)) !== 0)) return false;
    }
    return true;
  };
  if (!fits(c0, out[c0]!)) return null;
  /** Every empty neighbor of i can still take some remaining tile. */
  const forward = (i: number): boolean => {
    for (const d of DIRS) {
      const j = neighbour(p, i, d);
      if (j < 0 || out[j]! >= 0) continue;
      if (!types.some((t) => counts.get(t)! > 0 && fits(j, t))) return false;
    }
    return true;
  };
  /** Joining i to the placed pieces makes no loop, and doesn't close off a network that misses cells. */
  const shapeOk = (i: number): boolean => {
    const comp = new Int32Array(n).fill(-1);
    comp[i] = 0;
    const stack = [i];
    let size = 0, open = false;
    const via = new Int32Array(n).fill(-1);
    while (stack.length) {
      const a = stack.pop()!;
      size++;
      for (const d of DIRS) {
        if (!(out[a]! & d)) continue;
        const b = neighbour(p, a, d);
        if (b < 0) continue;
        if (out[b]! < 0) { open = true; continue; }
        if (b === via[a]) continue;
        if (comp[b] === 0) return false;
        comp[b] = 0;
        via[b] = a;
        stack.push(b);
      }
    }
    return open || size === n;
  };
  const place = (k: number): boolean => {
    if (k === order.length) return connected(p, p.barriers, out).every(Boolean);
    if (++nodes > NODE_BUDGET) return false;
    const i = order[k]!;
    for (const t of types) {
      const left = counts.get(t)!;
      if (!left || !fits(i, t)) continue;
      counts.set(t, left - 1);
      out[i] = t;
      if (shapeOk(i) && forward(i) && place(k + 1)) return true;
      out[i] = -1;
      counts.set(t, left);
    }
    return false;
  };
  return place(1) ? out : null;
}

const targets = new WeakMap<NetslidePuzzle, number[] | null>();
export function target(p: NetslidePuzzle): number[] | null {
  if (p.solution) return p.solution;
  if (!targets.has(p)) targets.set(p, findArrangement(p));
  return targets.get(p)!;
}

// --- hint engine ---

const specs = new Map<string, PermSpec<NetslideAction>>();

export function spec(p: Pick<NetslidePuzzle, "w" | "h">): PermSpec<NetslideAction> {
  const key = `netslide:${p.w}x${p.h}`;
  let s = specs.get(key);
  if (s) return s;
  const n = p.w * p.h;
  const ids = Array.from({ length: n }, (_, i) => i);
  const moves: PermMove<NetslideAction>[] = [];
  const add = (a: NetslideAction) => {
    if (!movable(p, a)) return;
    const after = shift(p.w, p.h, ids, a);
    const to = new Int32Array(n);
    after.forEach((from, cell) => { to[from] = cell; });
    moves.push({ action: a, to, turn: null });
  };
  for (let y = 0; y < p.h; y++) for (const by of [1, -1]) add({ type: "shift", line: "row", index: y, by });
  for (let x = 0; x < p.w; x++) for (const by of [1, -1]) add({ type: "shift", line: "col", index: x, by });
  const c = centre(p);
  s = { key, n, turns: 1, moves, order: ids.filter((i) => i !== c), distinct: false, endgame: 8 };
  specs.set(key, s);
  return s;
}

const stepCache = new WeakMap<readonly number[], PermStep<NetslideAction> | null>();
export function hintFor(p: NetslidePuzzle, s: NetslideState): PermStep<NetslideAction> | null {
  if (stepCache.has(s.tiles)) return stepCache.get(s.tiles)!;
  const goal = target(p);
  const st = goal ? nextStep(spec(p), goal, { values: s.tiles }) : null;
  stepCache.set(s.tiles, st);
  return st;
}

// --- formats ---

const HEX = "0123456789abcdef";

function checkSize(w: number, h: number): void {
  if (!(w >= 2 && h >= 2 && w <= 16 && h <= 16)) throw new Error("each side must be between 2 and 16");
}

function finish(p: NetslidePuzzle): NetslidePuzzle {
  const n = p.w * p.h;
  const ends = p.tiles.reduce((a, m) => a + degree(m), 0);
  if (ends !== 2 * (n - 1)) throw new Error(`the tiles have ${ends} ends in total, but one network joining all ${n} tiles needs exactly ${2 * (n - 1)}`);
  return { ...p, barriers: normalizeBarriers(p, p.barriers) };
}

const SGT_RE = /^(\d+)(?:x(\d+))?(w?)(?:b[\d.]+)?(?:m\d+)?:([0-9a-fA-Fhv]+)$/;

/** Simon Tatham's Netslide game id: `WxH[w][bP][mN]:` then a hex digit per tile, each followed by `v` (wall right) and/or `h` (wall below). */
export const sgtFormat: Format<NetslidePuzzle> = {
  id: "sgt",
  label: "sgt game id (WxH[w]:tiles)",
  detect: (t) => SGT_RE.test(t.trim()),
  parse(text) {
    const m = SGT_RE.exec(text.trim());
    if (!m) throw new Error("expected an sgt netslide id like 3x3:2a9c…");
    const w = Number(m[1]), h = Number(m[2] ?? m[1]);
    checkSize(w, h);
    const desc = m[4]!;
    const tiles: number[] = [], barriers: number[] = [];
    let at = 0;
    for (let i = 0; i < w * h; i++) {
      const t = HEX.indexOf(desc[at]?.toLowerCase() ?? "");
      if (t < 0) throw new Error(at >= desc.length ? `expected ${w * h} tiles, got ${i}` : `unexpected "${desc[at]}" at position ${at + 1}`);
      at++;
      let b = 0;
      while (desc[at] === "v" || desc[at] === "h") b |= desc[at++] === "v" ? R : D;
      tiles.push(t);
      barriers.push(b);
    }
    if (at !== desc.length) throw new Error(`more than ${w * h} tiles`);
    return finish({ w, h, wrap: m[3] === "w", tiles, barriers });
  },
  serialize(p) {
    let out = "";
    for (let i = 0; i < p.w * p.h; i++) {
      out += HEX[p.tiles[i]!];
      if (p.barriers[i]! & R && neighbour(p, i, R) >= 0) out += "v";
      if (p.barriers[i]! & D && neighbour(p, i, D) >= 0) out += "h";
    }
    return `${p.w}x${p.h}${p.wrap ? "w" : ""}:${out}`;
  },
};

/** Box-drawing glyph per tile mask. */
export const GLYPHS = " ╶╵└╴─┘┴╷┌│├┐┬┤┼";
const SIDES: Record<string, number> = { right: R, up: U, left: L, down: D };

/**
 * ```
 * netslide 3x3 [wrap]
 * ╶┬┐
 * ...
 * barrier 1,2 right
 * ```
 * Coordinates 1-based column,row.
 */
export const gridFormat: Format<NetslidePuzzle> = {
  id: "grid",
  label: "grid (box drawing)",
  detect: (t) => /^\s*netslide\s+\d+x\d+/.test(t),
  parse(text) {
    const lines = text.split(/\r?\n/).filter((l) => l.trim() !== "" && !l.trimStart().startsWith("#"));
    const head = /^\s*netslide\s+(\d+)x(\d+)((?:\s+\S+)*)\s*$/.exec(lines[0] ?? "");
    if (!head) throw new Error("first line should look like: netslide 4x4 [wrap]");
    const w = Number(head[1]), h = Number(head[2]);
    checkSize(w, h);
    const opts = head[3]!.trim().split(/\s+/).filter(Boolean);
    for (const o of opts) if (o !== "wrap") throw new Error(`unknown option "${o}" on the first line`);
    const tiles: number[] = [];
    for (let y = 0; y < h; y++) {
      const row = [...(lines[1 + y] ?? "")];
      for (let x = 0; x < w; x++) {
        const t = GLYPHS.indexOf(row[x] ?? "");
        if (t <= 0) throw new Error(`row ${y + 1}: "${row[x] ?? ""}" isn't a pipe piece`);
        tiles.push(t);
      }
    }
    const barriers = tiles.map(() => 0);
    for (const line of lines.slice(1 + h)) {
      const b = /^\s*barrier\s+(\d+),(\d+)\s+(right|up|left|down)\s*$/.exec(line);
      if (!b) throw new Error(`can't read "${line.trim()}" (expected: barrier X,Y right|down|left|up)`);
      const x = Number(b[1]) - 1, y = Number(b[2]) - 1;
      if (x < 0 || y < 0 || x >= w || y >= h) throw new Error(`barrier ${b[1]},${b[2]} is outside the grid`);
      barriers[y * w + x]! |= SIDES[b[3]!]!;
    }
    return finish({ w, h, wrap: opts.includes("wrap"), tiles, barriers });
  },
  serialize(p) {
    const rows: string[] = [];
    for (let y = 0; y < p.h; y++) rows.push(p.tiles.slice(y * p.w, (y + 1) * p.w).map((m) => GLYPHS[m]).join(""));
    const bars: string[] = [];
    p.barriers.forEach((b, i) => {
      for (const d of [R, D]) if (b & d && neighbour(p, i, d) >= 0) bars.push(`barrier ${(i % p.w) + 1},${Math.floor(i / p.w) + 1} ${d === R ? "right" : "down"}`);
    });
    return [`netslide ${p.w}x${p.h}${p.wrap ? " wrap" : ""}`, ...rows, ...bars].join("\n");
  },
};

export function describeShift(a: NetslideAction): string {
  const dir = a.line === "row" ? (a.by > 0 ? "right" : "left") : (a.by > 0 ? "down" : "up");
  const times = Math.abs(a.by) === 1 ? "" : ` ${Math.abs(a.by)} places`;
  return `${a.line === "row" ? `row ${rowName(a.index)}` : `column ${colName(a.index)}`} ${dir}${times}`;
}

const ratingCache = new WeakMap<NetslidePuzzle, Rating | null>();

function rate(p: NetslidePuzzle): Rating | null {
  if (ratingCache.has(p)) return ratingCache.get(p)!;
  const goal = target(p);
  const moves = goal ? solveAll(spec(p), goal, { values: p.tiles }) : null;
  const r = moves ? { label: `${moves.length} slides`, score: moves.length } : null;
  ratingCache.set(p, r);
  return r;
}

export const netslide: PuzzleDef<NetslidePuzzle, NetslideState, NetslideAction, NetslideInteraction, typeof params> = {
  id: "netslide",
  name: "netslide",
  aliases: ["netslide", "sliding net", "pipes"],
  tags: ["sliding", "moves", "network"],
  description: "slide rows and columns of pipe pieces round until every piece joins up into one network with the center.",
  generatorVersion: 1,
  params,
  presets: [
    { label: "3×3 easy", params: { width: 3, height: 3, barriers: 100 } },
    { label: "3×3 medium", params: { width: 3, height: 3, barriers: 0 } },
    { label: "4×4 easy", params: { width: 4, height: 4, barriers: 100 } },
    { label: "4×4 medium", params: { width: 4, height: 4, barriers: 0 } },
    { label: "4×4 hard", params: { width: 4, height: 4, barriers: 0, wrap: true } },
    { label: "5×5 medium", params: { width: 5, height: 5, barriers: 0 } },
  ],
  generate,
  formats: [sgtFormat, gridFormat],
  init: (p) => ({ tiles: p.tiles.slice(), moves: 0 }),
  initInteraction: () => ({ cursor: 0 }),
  reduce(p, s, a) {
    if (a.type !== "shift" || !Number.isInteger(a.by) || !movable(p, a)) return s;
    const len = a.line === "row" ? p.w : p.h;
    if (a.by % len === 0) return s;
    return { tiles: shift(p.w, p.h, s.tiles, a), moves: s.moves + 1 };
  },
  isSolved: (p, s) => isSolvedTiles(p, s.tiles),
  solve(p) {
    const goal = target(p);
    return goal ? { tiles: goal.slice(), moves: 0 } : null;
  },
  rate,
  hint: (p) => (target(p) ? null : { message: "no finished arrangement of these pieces turned up, so there's no hint for this board" }),
  rules: (p) => [
    "a move slides one whole row or column along by one; the piece pushed off one end comes back on at the other.",
    "the middle row and the middle column can't slide, so the center piece never moves.",
    `connect every piece into one network with the center: pipe ends must meet, and can't cross the thick walls${p.wrap ? "" : " or the board's edge"}.`,
    ...(p.wrap ? ["pipes may run off one edge and come back on the opposite one."] : []),
  ],
  describe: (p) => `${p.w}×${p.h}${p.wrap ? " wrapping" : ""}`,
};
