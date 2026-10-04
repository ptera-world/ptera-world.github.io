import { cellName } from "../../core/names";
import type { Rng } from "../../core/rng";
import { defineSchema, type Values } from "../../core/schema";
import type { Format, GenerateContext, PuzzleDef, Rating } from "../../core/types";
import { nextStep, solveAll, type PermMove, type PermSpec, type PermStep } from "./perm";

export const params = defineSchema({
  width: { type: "int", label: "width", default: 3, min: 2, max: 7 },
  height: { type: "int", label: "height", default: 3, min: 2, max: 7 },
  rowsOnly: { type: "bool", label: "rows only", default: false, description: "every tile in a row is the same number, so only which row a tile ends up in matters" },
  orientable: { type: "bool", label: "tiles must end upright", default: false, description: "tiles turn with the block, and each must finish pointing up" },
  shuffle: { type: "int", label: "scramble turns (0 = thorough)", default: 0, min: 0, max: 2000, description: "how many random turns mix the board up" },
});

export interface TwiddlePuzzle {
  w: number;
  h: number;
  /** Block size. */
  n: number;
  rowsOnly: boolean;
  orientable: boolean;
  /** Row-major numbers, 1-based. */
  tiles: number[];
  /** Quarter turns anticlockwise from upright, per cell (all 0 unless orientable). */
  turns: number[];
}

export interface TwiddleState {
  tiles: number[];
  turns: number[];
  moves: number;
}

/** Turn the n×n block whose top-left cell is (x, y). */
export type TwiddleAction = { type: "rotate"; x: number; y: number; clockwise: boolean };

export interface TwiddleFocus {
  /** Cells the hinted step moves. */
  moving?: number[];
  /** Top-left cells of the blocks the step turns, in order. */
  blocks?: number[];
  home?: number;
  tile?: number;
}

export interface TwiddleInteraction {
  /** Top-left cell of the keyboard-selected block. */
  cursor: number;
}

type Shape = Pick<TwiddlePuzzle, "w" | "h" | "n" | "orientable">;

export function rotate<T extends { tiles: number[]; turns: number[] }>(p: Shape, s: T, a: TwiddleAction): { tiles: number[]; turns: number[] } {
  const tiles = s.tiles.slice(), turns = s.turns.slice();
  for (let j = 0; j < p.n; j++) for (let i = 0; i < p.n; i++) {
    const from = (a.y + j) * p.w + a.x + i;
    const [ti, tj] = a.clockwise ? [p.n - 1 - j, i] : [j, p.n - 1 - i];
    const to = (a.y + tj) * p.w + a.x + ti;
    tiles[to] = s.tiles[from]!;
    turns[to] = p.orientable ? (s.turns[from]! + (a.clockwise ? 3 : 1)) % 4 : 0;
  }
  return { tiles, turns };
}

export const goalTile = (p: Pick<TwiddlePuzzle, "w" | "rowsOnly">, c: number): number => (p.rowsOnly ? Math.floor(c / p.w) + 1 : c + 1);

export function isSolvedTiles(p: TwiddlePuzzle, s: { tiles: readonly number[]; turns: readonly number[] }): boolean {
  return s.tiles.every((t, c) => t === goalTile(p, c)) && (!p.orientable || s.turns.every((o) => o === 0));
}

const specs = new Map<string, PermSpec<TwiddleAction>>();

export function spec(p: Shape): PermSpec<TwiddleAction> {
  const key = `twiddle:${p.w}x${p.h}n${p.n}${p.orientable ? "o" : ""}`;
  let s = specs.get(key);
  if (s) return s;
  const cells = p.w * p.h;
  const ids = Array.from({ length: cells }, (_, i) => i);
  const zero = ids.map(() => 0);
  const moves: PermMove<TwiddleAction>[] = [];
  for (let y = 0; y <= p.h - p.n; y++) for (let x = 0; x <= p.w - p.n; x++) {
    for (const clockwise of [false, true]) {
      const a: TwiddleAction = { type: "rotate", x, y, clockwise };
      const after = rotate({ ...p, orientable: true }, { tiles: ids, turns: zero }, a);
      const to = new Int32Array(cells), turn = p.orientable ? new Int8Array(cells) : null;
      after.tiles.forEach((from, c) => {
        to[from] = c;
        if (turn) turn[from] = after.turns[c]!;
      });
      moves.push({ action: a, to, turn });
    }
  }
  const order: number[] = [];
  for (let y = 0; y < p.h - p.n; y++) for (let x = 0; x < p.w; x++) order.push(y * p.w + x);
  for (let x = 0; x < p.w; x++) for (let y = p.h - p.n; y < p.h; y++) order.push(y * p.w + x);
  s = { key, n: cells, turns: p.orientable ? 4 : 1, moves, order, distinct: true, endgame: p.orientable ? 4 : 6 };
  specs.set(key, s);
  return s;
}

const goalCache = new Map<string, number[]>();
export function goal(p: TwiddlePuzzle): number[] {
  const key = `${p.w}x${p.h}${p.rowsOnly ? "r" : ""}`;
  let g = goalCache.get(key);
  if (!g) goalCache.set(key, (g = Array.from({ length: p.w * p.h }, (_, c) => goalTile(p, c))));
  return g;
}

/** Rows-only boards repeat numbers, so arrangement parity says nothing there. */
const specFor = (p: TwiddlePuzzle): PermSpec<TwiddleAction> => (p.rowsOnly ? { ...spec(p), distinct: false, key: `${spec(p).key}r` } : spec(p));

const stepCache = new WeakMap<readonly number[], { turns: readonly number[]; step: PermStep<TwiddleAction> | null }>();
export function hintFor(p: TwiddlePuzzle, s: TwiddleState): PermStep<TwiddleAction> | null {
  const hit = stepCache.get(s.tiles);
  if (hit && hit.turns === s.turns) return hit.step;
  const step = nextStep(specFor(p), goal(p), { values: s.tiles, turns: p.orientable ? s.turns : undefined });
  stepCache.set(s.tiles, { turns: s.turns, step });
  return step;
}

async function generate(v: Values<typeof params>, rng: Rng, ctx: GenerateContext): Promise<TwiddlePuzzle> {
  const w = v.width, h = v.height, n = 2;
  const base: TwiddlePuzzle = { w, h, n, rowsOnly: v.rowsOnly, orientable: v.orientable, tiles: [], turns: [] };
  const solved = { tiles: Array.from({ length: w * h }, (_, c) => goalTile(base, c)), turns: Array.from({ length: w * h }, () => 0) };
  const rw = w - n + 1, rh = h - n + 1;
  const total = v.shuffle || w * h * n * n * 2 + rng.int(2);
  let s = solved;
  for (let attempt = 0; attempt < 20; attempt++) {
    s = solved;
    const net = new Int32Array(rw * rh);
    for (let i = 0; i < total; i++) {
      let x: number, y: number, dir: number, ok: boolean;
      do {
        x = rng.int(rw);
        y = rng.int(rh);
        dir = rng.bool() ? 1 : -1;
        const old = net[y * rw + x]!, next = old + dir;
        ok = rw * rh === 1 || (Math.abs(next) >= Math.abs(old) && Math.abs(next) <= 2);
      } while (!ok);
      s = rotate(base, s, { type: "rotate", x, y, clockwise: dir < 0 });
      net[y * rw + x] = net[y * rw + x]! + dir;
      for (let dy = -n + 1; dy < n; dy++) for (let dx = -n + 1; dx < n; dx++) {
        const ox = x + dx, oy = y + dy;
        if ((dx || dy) && ox >= 0 && oy >= 0 && ox < rw && oy < rh) net[oy * rw + ox] = 0;
      }
      if (i % 2000 === 1999) await ctx.yield();
    }
    if (!isSolvedTiles(base, s)) break;
  }
  return { ...base, tiles: s.tiles, turns: s.turns };
}

const LETTERS = "uldr";

function check(p: TwiddlePuzzle): TwiddlePuzzle {
  const { w, h, n } = p;
  if (!(w >= 2 && h >= 2 && w <= 12 && h <= 12)) throw new Error("each side must be between 2 and 12");
  if (n !== 2) throw new Error("only 2×2 blocks are supported here (the hint method has no way to finish larger ones yet)");
  if (p.tiles.length !== w * h) throw new Error(`expected ${w * h} tiles, got ${p.tiles.length}`);
  const want = Array.from({ length: w * h }, (_, c) => goalTile(p, c)).sort((a, b) => a - b).join();
  if (p.tiles.slice().sort((a, b) => a - b).join() !== want) {
    throw new Error(p.rowsOnly ? `each row number 1 to ${h} must appear ${w} times` : `the numbers must be 1 to ${w * h}, each once`);
  }
  return p;
}

const SGT_RE = /^(\d+)(?:x(\d+))?(?:n(\d+))?([rom\d]*):([\d,uldr]+)$/;

/** Simon Tatham's Twiddle game id: `WxHnN[r][o][mK]:` then the numbers, separated by commas or (orientable) by u/l/d/r. */
export const sgtFormat: Format<TwiddlePuzzle> = {
  id: "sgt",
  label: "sgt game id (WxHnN[r][o]:…)",
  detect: (t) => SGT_RE.test(t.trim()),
  parse(text) {
    const m = SGT_RE.exec(text.trim());
    if (!m) throw new Error("expected WxHnN:n,n,…, e.g. 3x3n2:1,2,3,…");
    const w = Number(m[1]), h = Number(m[2] ?? m[1]), n = Number(m[3] ?? 2);
    const flags = m[4]!.replace(/m\d*/, "");
    const rowsOnly = flags.includes("r"), orientable = flags.includes("o");
    const tiles: number[] = [], turns: number[] = [];
    const re = orientable ? /(\d+)([uldr])/y : /(\d+)(,|$)/y;
    const body = m[5]!;
    while (re.lastIndex < body.length) {
      const t = re.exec(body);
      if (!t) throw new Error(orientable ? "each number must be followed by an orientation letter (u, l, d or r)" : "expected numbers separated by commas");
      tiles.push(Number(t[1]));
      turns.push(orientable ? LETTERS.indexOf(t[2]!) : 0);
    }
    return check({ w, h, n, rowsOnly, orientable, tiles, turns });
  },
  serialize(p) {
    const flags = `${p.rowsOnly ? "r" : ""}${p.orientable ? "o" : ""}`;
    const body = p.orientable ? p.tiles.map((t, c) => `${t}${LETTERS[p.turns[c]!]}`).join("") : p.tiles.join(",");
    return `${p.w}x${p.h}n${p.n}${flags}:${body}`;
  },
};

/**
 * ```
 * twiddle block=2 [rows] [orientable]
 * 1 5 3
 * 4l 2 6d
 * ```
 * One row per line; with orientable, a tile may carry u/l/d/r for the way it points (default u).
 */
export const gridFormat: Format<TwiddlePuzzle> = {
  id: "grid",
  label: "grid (twiddle block=N header, then rows)",
  detect: (t) => /^\s*twiddle\b/.test(t),
  parse(text) {
    const lines = text.trim().split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
    const head = /^twiddle((?:\s+\S+)*)$/.exec(lines[0] ?? "");
    if (!head) throw new Error("first line should look like: twiddle block=2 [rows] [orientable]");
    const words = head[1]!.trim().split(/\s+/).filter(Boolean);
    const n = Number(/^block=(\d+)$/.exec(words.find((x) => x.startsWith("block=")) ?? "block=2")?.[1] ?? 2);
    const rowsOnly = words.includes("rows"), orientable = words.includes("orientable");
    const rows = lines.slice(1).map((r) => r.split(/[\s,]+/));
    const h = rows.length, w = rows[0]?.length ?? 0;
    if (rows.some((r) => r.length !== w)) throw new Error("rows have different lengths");
    const cells = rows.flat().map((t) => {
      const m = /^(\d+)([uldr]?)$/.exec(t);
      if (!m) throw new Error(`can't read "${t}"`);
      return { t: Number(m[1]), o: m[2] ? LETTERS.indexOf(m[2]) : 0 };
    });
    if (!orientable && cells.some((c) => c.o)) throw new Error("orientation letters need 'orientable' in the header");
    return check({ w, h, n, rowsOnly, orientable, tiles: cells.map((c) => c.t), turns: cells.map((c) => c.o) });
  },
  serialize(p) {
    const head = `twiddle block=${p.n}${p.rowsOnly ? " rows" : ""}${p.orientable ? " orientable" : ""}`;
    const width = String(Math.max(...p.tiles)).length + (p.orientable ? 1 : 0);
    const rows: string[] = [];
    for (let y = 0; y < p.h; y++) {
      rows.push(Array.from({ length: p.w }, (_, x) => {
        const c = y * p.w + x;
        return `${p.tiles[c]}${p.orientable && p.turns[c] ? LETTERS[p.turns[c]!] : ""}`.padEnd(width);
      }).join(" ").trimEnd());
    }
    return [head, ...rows].join("\n");
  },
};

export const blockName = (p: Pick<TwiddlePuzzle, "w" | "n">, x: number, y: number): string =>
  `the block ${cellName(x, y)}–${cellName(x + p.n - 1, y + p.n - 1)}`;

export function describeTurn(p: Pick<TwiddlePuzzle, "w" | "n">, a: TwiddleAction): string {
  return `turn ${blockName(p, a.x, a.y)} ${a.clockwise ? "clockwise" : "anticlockwise"}`;
}

const ratingCache = new WeakMap<TwiddlePuzzle, Rating | null>();

function rate(p: TwiddlePuzzle): Rating | null {
  if (ratingCache.has(p)) return ratingCache.get(p)!;
  const moves = solveAll(specFor(p), goal(p), { values: p.tiles, turns: p.orientable ? p.turns : undefined });
  const r = moves ? { label: `${moves.length} turns`, score: moves.length } : null;
  ratingCache.set(p, r);
  return r;
}

export const twiddle: PuzzleDef<TwiddlePuzzle, TwiddleState, TwiddleAction, TwiddleInteraction, typeof params> = {
  id: "twiddle",
  name: "twiddle",
  aliases: ["twiddle", "rotation puzzle", "gripple"],
  tags: ["permutation", "moves", "rotation"],
  description: "turn square blocks of tiles a quarter at a time until the numbers are back in order.",
  generatorVersion: 1,
  params,
  presets: [
    { label: "3×3 rows only", params: { width: 3, height: 3, rowsOnly: true } },
    { label: "3×3", params: { width: 3, height: 3 } },
    { label: "3×3 upright", params: { width: 3, height: 3, orientable: true } },
    { label: "4×4", params: { width: 4, height: 4 } },
    { label: "4×4 upright", params: { width: 4, height: 4, orientable: true } },
    { label: "6×6", params: { width: 6, height: 6 } },
  ],
  generate,
  formats: [sgtFormat, gridFormat],
  init: (p) => ({ tiles: p.tiles.slice(), turns: p.turns.slice(), moves: 0 }),
  initInteraction: () => ({ cursor: 0 }),
  reduce(p, s, a) {
    if (a.type !== "rotate" || a.x < 0 || a.y < 0 || a.x > p.w - p.n || a.y > p.h - p.n) return s;
    return { ...rotate(p, s, a), moves: s.moves + 1 };
  },
  isSolved: (p, s) => isSolvedTiles(p, s),
  solve: (p) => ({ tiles: goal(p).slice(), turns: p.turns.map(() => 0), moves: 0 }),
  rate,
  rules: (p) => [
    `a move turns one ${p.n}×${p.n} block of tiles a quarter turn, either way.`,
    p.rowsOnly
      ? `every tile is numbered with the row it belongs in: get each row filled with its own number.`
      : `get the numbers 1 to ${p.w * p.h} in order, reading left to right and top to bottom.`,
    ...(p.orientable ? ["tiles turn with their block: every tile must also end up pointing upright."] : []),
  ],
  describe: (p) => `${p.w}×${p.h}${p.rowsOnly ? ", rows only" : ""}${p.orientable ? ", upright" : ""}`,
};
