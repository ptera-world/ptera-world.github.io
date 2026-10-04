import type { Rng } from "../../core/rng";
import { defineSchema, type Values } from "../../core/schema";
import type { Format, PuzzleDef, Rating } from "../../core/types";
import { fullPlan } from "./solver";

export const params = defineSchema({
  width: { type: "int", label: "width", default: 4, min: 2, max: 8 },
  height: { type: "int", label: "height", default: 4, min: 2, max: 8 },
  shuffle: {
    type: "int", label: "scramble moves (0 = fully random)", default: 0, min: 0, max: 1000,
    description: "fully random boards are any solvable arrangement; a small number of random moves gives an easier board",
  },
});

export interface FifteenPuzzle {
  w: number;
  h: number;
  /** Row-major; 0 is the gap, 1…n-1 the tiles. Solved: 1…n-1 in order with the gap last. */
  tiles: number[];
}

export interface FifteenState {
  tiles: number[];
  /** Tiles moved so far (sliding a line of three counts three). */
  moves: number;
}

/** Slide the tiles between `cell` and the gap one step towards the gap. `cell` must share a row or column with it. */
export type FifteenAction = { type: "move"; cell: number };

/** Hint focus understood by the view: cells to press, the group's home cells, and the group's tiles. */
export interface FifteenFocus {
  press?: number[];
  homes?: number[];
  tiles?: number[];
}

export const home = (n: number, tile: number): number => (tile === 0 ? n - 1 : tile - 1);
export const solvedTile = (n: number, cell: number): number => (cell === n - 1 ? 0 : cell + 1);
export const gapOf = (tiles: readonly number[]): number => tiles.indexOf(0);

/** Parity of the arrangement read as a permutation (gap counted as tile n). */
function permParity(tiles: readonly number[]): number {
  const n = tiles.length;
  const seen = new Uint8Array(n);
  let parity = 0;
  for (let i = 0; i < n; i++) {
    if (seen[i]) continue;
    let len = 0;
    for (let j = i; !seen[j]; j = home(n, tiles[j]!)) { seen[j] = 1; len++; }
    parity ^= (len - 1) & 1;
  }
  return parity;
}

/** Every move swaps the gap with a neighbour, so arrangement parity and gap distance parity stay matched. */
export function isSolvable(w: number, h: number, tiles: readonly number[]): boolean {
  const g = gapOf(tiles);
  const dist = (w - 1 - (g % w)) + (h - 1 - Math.floor(g / w));
  return permParity(tiles) === (dist & 1);
}

/** Cells the gap passes through for a move from `cell`, nearest the gap first; empty if not in line. */
export function lineToGap(w: number, tiles: readonly number[], cell: number): number[] {
  const g = gapOf(tiles);
  if (cell === g || cell < 0 || cell >= tiles.length) return [];
  const gx = g % w, gy = Math.floor(g / w), cx = cell % w, cy = Math.floor(cell / w);
  if (gx !== cx && gy !== cy) return [];
  const step = gx === cx ? (cy > gy ? w : -w) : (cx > gx ? 1 : -1);
  const out: number[] = [];
  for (let p = g + step; ; p += step) {
    out.push(p);
    if (p === cell) return out;
  }
}

export function applyMove(w: number, s: FifteenState, cell: number): FifteenState {
  const path = lineToGap(w, s.tiles, cell);
  if (!path.length) return s;
  const tiles = s.tiles.slice();
  let gap = gapOf(tiles);
  for (const p of path) {
    tiles[gap] = tiles[p]!;
    tiles[p] = 0;
    gap = p;
  }
  return { tiles, moves: s.moves + path.length };
}

export const isSolvedTiles = (tiles: readonly number[]): boolean => tiles.every((t, i) => t === solvedTile(tiles.length, i));

function generate(v: Values<typeof params>, rng: Rng): FifteenPuzzle {
  const w = v.width, h = v.height, n = w * h;
  let tiles: number[];
  if (v.shuffle > 0) {
    tiles = Array.from({ length: n }, (_, i) => solvedTile(n, i));
    let prev = -1;
    for (let i = 0; i < v.shuffle; i++) {
      const g = gapOf(tiles);
      const opts = [g - w, g + w, (g % w) > 0 ? g - 1 : -1, (g % w) < w - 1 ? g + 1 : -1]
        .filter((c) => c >= 0 && c < n && c !== prev);
      const c = rng.pick(opts);
      tiles[g] = tiles[c]!;
      tiles[c] = 0;
      prev = g;
    }
  } else {
    tiles = rng.shuffle(Array.from({ length: n }, (_, i) => i));
    if (!isSolvable(w, h, tiles)) {
      const a = tiles.findIndex((t) => t !== 0);
      const b = tiles.findIndex((t, i) => i > a && t !== 0);
      [tiles[a], tiles[b]] = [tiles[b]!, tiles[a]!];
    }
  }
  if (isSolvedTiles(tiles)) {
    const g = gapOf(tiles), c = g - 1;
    tiles[g] = tiles[c]!;
    tiles[c] = 0;
  }
  return { w, h, tiles };
}

function checkTiles(w: number, h: number, tiles: number[]): FifteenPuzzle {
  if (!(w >= 2 && h >= 2 && w <= 16 && h <= 16)) throw new Error("each side must be between 2 and 16");
  const n = w * h;
  if (tiles.length !== n) throw new Error(`expected ${n} numbers, got ${tiles.length}`);
  const seen = new Set<number>();
  for (const t of tiles) {
    if (!Number.isInteger(t) || t < 0 || t >= n) throw new Error(`numbers must run from 0 (the gap) to ${n - 1}`);
    if (seen.has(t)) throw new Error(`${t} appears twice`);
    seen.add(t);
  }
  if (!isSolvable(w, h, tiles)) throw new Error("this arrangement can't be solved (two tiles would have to swap)");
  return { w, h, tiles };
}

const SGT_RE = /^(\d+)(?:x(\d+))?:([\d,\s]+)$/;

/** Simon Tatham's Fifteen game id: `WxH:` then every cell's number, comma-separated, 0 for the gap. */
export const sgtFormat: Format<FifteenPuzzle> = {
  id: "sgt",
  label: "sgt game id (WxH:n,n,…)",
  detect: (t) => SGT_RE.test(t.trim()),
  parse(text) {
    const m = SGT_RE.exec(text.trim());
    if (!m) throw new Error("expected WxH:n,n,…, e.g. 4x4:1,2,3,…,0");
    const w = Number(m[1]), h = Number(m[2] ?? m[1]);
    return checkTiles(w, h, m[3]!.split(",").map((s) => Number(s.trim())));
  },
  serialize: (p) => `${p.w}x${p.h}:${p.tiles.join(",")}`,
};

/** One row per line, numbers separated by spaces; the gap is 0, `.` or `_`. */
export const gridFormat: Format<FifteenPuzzle> = {
  id: "grid",
  label: "grid (rows of numbers, . for the gap)",
  detect: (t) => t.trim().includes("\n") && /^[\d\s._,]+$/.test(t.trim()),
  parse(text) {
    const rows = text.trim().split(/\r?\n/).map((r) => r.trim()).filter(Boolean).map((r) => r.split(/[\s,]+/));
    const h = rows.length, w = rows[0]?.length ?? 0;
    if (rows.some((r) => r.length !== w)) throw new Error("rows have different lengths");
    return checkTiles(w, h, rows.flat().map((t) => (t === "." || t === "_" ? 0 : Number(t))));
  },
  serialize(p) {
    const width = String(p.w * p.h - 1).length;
    const rows: string[] = [];
    for (let y = 0; y < p.h; y++) {
      rows.push(p.tiles.slice(y * p.w, y * p.w + p.w).map((t) => (t === 0 ? "." : String(t)).padStart(width)).join(" "));
    }
    return rows.join("\n");
  },
};

const ratingCache = new WeakMap<FifteenPuzzle, Rating | null>();

function rate(p: FifteenPuzzle): Rating | null {
  if (ratingCache.has(p)) return ratingCache.get(p)!;
  const plan = fullPlan(p, { tiles: p.tiles });
  const r = plan ? { label: `${plan.length} moves`, score: plan.length } : null;
  ratingCache.set(p, r);
  return r;
}

export const fifteen: PuzzleDef<FifteenPuzzle, FifteenState, FifteenAction, null, typeof params> = {
  id: "fifteen",
  name: "fifteen",
  aliases: ["15 puzzle", "sliding puzzle", "gem puzzle", "sliding tiles"],
  tags: ["classic", "sliding", "moves"],
  description: "slide the numbered tiles around using the one gap until they're in order.",
  generatorVersion: 1,
  params,
  presets: [
    { label: "3×3", params: { width: 3, height: 3 } },
    { label: "4×4", params: { width: 4, height: 4 } },
    { label: "5×5", params: { width: 5, height: 5 } },
    { label: "4×4 · 20 moves", params: { width: 4, height: 4, shuffle: 20 } },
  ],
  generate,
  formats: [sgtFormat, gridFormat],
  init: (p) => ({ tiles: p.tiles.slice(), moves: 0 }),
  reduce(p, s, a) {
    if (a.type !== "move") return s;
    return applyMove(p.w, s, a.cell);
  },
  isSolved: (_p, s) => isSolvedTiles(s.tiles),
  solve: (p) => ({ tiles: p.tiles.map((_, i) => solvedTile(p.tiles.length, i)), moves: 0 }),
  rate,
  rules: (p) => [
    `the tiles 1 to ${p.w * p.h - 1} sit in a ${p.w}×${p.h} frame with one gap.`,
    "a tile next to the gap can slide into it. clicking a tile further along the gap's row or column slides the whole line.",
    "get the tiles in order, reading left to right and top to bottom, with the gap in the bottom-right corner.",
  ],
  describe: (p) => `${p.w}×${p.h}`,
};
