import type { Rng } from "../../core/rng";
import { defineSchema, type Values } from "../../core/schema";
import type { Format, PuzzleDef } from "../../core/types";
import { sha1 } from "../../lib/sha1";

/** Directions: 0 up, 1 right, 2 down, 3 left. */
export const DIR_NAMES = ["up", "right", "down", "left"] as const;

export const params = defineSchema({
  size: { type: "int", label: "size", default: 4, min: 3, max: 6 },
  target: {
    type: "enum", label: "goal tile", default: "2048",
    options: ["64", "128", "256", "512", "1024", "2048", "4096", "8192"].map((v) => ({ value: v, label: v })),
  },
});

export interface Puzzle2048 {
  size: number;
  /** The goal tile, as a power of two (11 for 2048). */
  target: number;
  /** Tiles as powers of two (0 empty), row by row. */
  start: number[];
  /** Random state new tiles are drawn from; the same seed always brings the same tiles. */
  seed: number;
}

export interface State2048 {
  grid: number[];
  score: number;
  /** Random state for the next new tile. */
  seed: number;
  moves: number;
}

export type Action2048 = { type: "slide"; dir: number };

export interface Focus2048 {
  dir?: number;
  /** Cells to point at. */
  cells?: number[];
}

/** One mulberry32 step: the next state and a uniform number in [0, 1). */
export function draw(seed: number): [number, number] {
  const next = (seed + 0x6d2b79f5) >>> 0;
  let t = next;
  t = Math.imul(t ^ (t >>> 15), t | 1);
  t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
  return [next, ((t ^ (t >>> 14)) >>> 0) / 4294967296];
}

/** A new tile (a 2, or a 4 one time in ten) on a random empty cell. */
export function spawn(grid: readonly number[], seed: number): { grid: number[]; seed: number; cell: number } {
  const empty = grid.flatMap((v, c) => (v ? [] : [c]));
  if (!empty.length) return { grid: grid.slice(), seed, cell: -1 };
  const [s1, a] = draw(seed);
  const [s2, b] = draw(s1);
  const cell = empty[Math.floor(a * empty.length)]!;
  const out = grid.slice();
  out[cell] = b < 0.9 ? 1 : 2;
  return { grid: out, seed: s2, cell };
}

/** Cells of each line in the direction of travel, the front cell first. */
export function lines(n: number, dir: number): number[][] {
  const out: number[][] = [];
  for (let i = 0; i < n; i++) {
    const line: number[] = [];
    for (let k = 0; k < n; k++) {
      if (dir === 0) line.push(k * n + i);
      else if (dir === 2) line.push((n - 1 - k) * n + i);
      else if (dir === 3) line.push(i * n + k);
      else line.push(i * n + (n - 1 - k));
    }
    out.push(line);
  }
  return out;
}

export interface Slid {
  grid: number[];
  /** Points scored: the value of every merged tile. */
  gained: number;
  /** Every tile's journey: from, to, and whether it merged into another there. */
  moves: { from: number; to: number; merged: boolean }[];
  changed: boolean;
}

/** Slide every tile as far as it goes; two equal tiles that meet merge once. */
export function slide(n: number, grid: readonly number[], dir: number): Slid {
  const out = grid.slice();
  let gained = 0, changed = false;
  const moves: Slid["moves"] = [];
  for (const line of lines(n, dir)) {
    const vals: number[] = [];
    let open = false;
    for (const c of line) {
      const v = grid[c]!;
      if (!v) continue;
      if (open && vals[vals.length - 1] === v) {
        vals[vals.length - 1] = v + 1;
        gained += 2 ** (v + 1);
        open = false;
        moves.push({ from: c, to: line[vals.length - 1]!, merged: true });
      } else {
        vals.push(v);
        open = true;
        moves.push({ from: c, to: line[vals.length - 1]!, merged: false });
      }
    }
    line.forEach((c, k) => {
      const nv = vals[k] ?? 0;
      if (out[c] !== nv) changed = true;
      out[c] = nv;
    });
  }
  return { grid: out, gained, moves, changed };
}

export const canSlide = (n: number, grid: readonly number[], dir: number): boolean => slide(n, grid, dir).changed;

export function reduce(p: Puzzle2048, s: State2048, a: Action2048): State2048 {
  if (a.type !== "slide" || a.dir < 0 || a.dir > 3) return s;
  const r = slide(p.size, s.grid, a.dir);
  if (!r.changed) return s;
  const sp = spawn(r.grid, s.seed);
  return { grid: sp.grid, score: s.score + r.gained, seed: sp.seed, moves: s.moves + 1 };
}

export const best = (grid: readonly number[]): number => Math.max(0, ...grid);
export const tileValue = (v: number): number => (v ? 2 ** v : 0);

// --- formats ---

const seedOf = (text: string): number => {
  const h = sha1(new TextEncoder().encode(text));
  return ((h[0]! << 24) | (h[1]! << 16) | (h[2]! << 8) | h[3]!) >>> 0;
};

/**
 * Rows of tile values (0 or . for an empty cell), then optionally `goal 2048` and `seed 12345`
 * lines. Without a seed, one is made from the text, so the same text always plays the same.
 */
export const gridFormat: Format<Puzzle2048> = {
  id: "grid",
  label: "grid (rows of tiles, . for empty)",
  detect: (t) => /^[\d.\s]+((goal|seed)\s+\d+\s*)*$/i.test(t.trim()) && t.trim().includes("\n"),
  parse(text) {
    const lines = text.trim().split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
    let target = 11, seed: number | null = null;
    const rows: string[][] = [];
    for (const l of lines) {
      const m = /^(goal|seed)\s+(\d+)$/i.exec(l);
      if (m) {
        const v = Number(m[2]);
        if (m[1]!.toLowerCase() === "seed") seed = v >>> 0;
        else {
          const e = Math.log2(v);
          if (!Number.isInteger(e) || e < 3) throw new Error("the goal tile must be a power of two, 8 or more");
          target = e;
        }
        continue;
      }
      rows.push(l.split(/\s+/));
    }
    const n = rows.length;
    if (n < 2 || n > 8 || rows.some((r) => r.length !== n)) throw new Error("the board must be square, between 2×2 and 8×8");
    const start = rows.flat().map((t) => {
      if (t === "." || t === "0") return 0;
      const e = Math.log2(Number(t));
      if (!Number.isInteger(e) || e < 1) throw new Error(`"${t}" isn't a tile (2, 4, 8, …)`);
      return e;
    });
    return { size: n, target, start, seed: seed ?? seedOf(text) };
  },
  serialize(p) {
    const width = String(tileValue(best(p.start)) || 1).length;
    const rows: string[] = [];
    for (let y = 0; y < p.size; y++) rows.push(p.start.slice(y * p.size, y * p.size + p.size).map((v) => (v ? String(tileValue(v)) : ".").padStart(width)).join(" "));
    return `${rows.join("\n")}\ngoal ${tileValue(p.target)}\nseed ${p.seed}`;
  },
};

function generate(v: Values<typeof params>, rng: Rng): Puzzle2048 {
  const n = v.size;
  let seed = rng.int(2 ** 32) >>> 0;
  let grid = Array.from({ length: n * n }, () => 0);
  for (let i = 0; i < 2; i++) {
    const sp = spawn(grid, seed);
    grid = sp.grid;
    seed = sp.seed;
  }
  return { size: n, target: Math.log2(Number(v.target)), start: grid, seed };
}

export const game2048: PuzzleDef<Puzzle2048, State2048, Action2048, null, typeof params> = {
  id: "2048",
  name: "2048",
  aliases: ["sliding tiles game", "merge numbers"],
  tags: ["moves", "numbers", "endless"],
  description: "slide the tiles; two equal tiles that run into each other merge into one. reach the goal tile before the board fills up.",
  generatorVersion: 1,
  params,
  presets: [
    { label: "4×4 · 2048", params: { size: 4, target: "2048" } },
    { label: "3×3 · 128", params: { size: 3, target: "128" } },
    { label: "5×5 · 4096", params: { size: 5, target: "4096" } },
    { label: "6×6 · 8192", params: { size: 6, target: "8192" } },
  ],
  generate,
  formats: [gridFormat],
  init: (p) => ({ grid: p.start.slice(), score: 0, seed: p.seed, moves: 0 }),
  reduce,
  isSolved: (p, s) => best(s.grid) >= p.target,
  isLost: (p, s) => [0, 1, 2, 3].every((d) => !canSlide(p.size, s.grid, d)),
  describeAction(p, a, before, after) {
    if (a.type !== "slide") return "";
    const merged = after.score - before.score;
    return `${DIR_NAMES[a.dir]}${merged ? ` +${merged}` : ""}`;
  },
  rules: (p) => [
    "slide every tile up, down, left or right as far as it goes.",
    "two tiles with the same number that run into each other merge into one with their sum. a tile merges only once per slide.",
    "after every slide that moves something, a new 2 (sometimes a 4) appears on an empty cell.",
    `make a ${tileValue(p.target)} tile. the game is over when no slide moves anything; once you've won you can unlock the board and keep going.`,
  ],
  describe: (p) => `${p.size}×${p.size} · goal ${tileValue(p.target)}`,
};
