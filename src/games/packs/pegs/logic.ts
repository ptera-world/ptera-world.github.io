import { cellName as cellAt } from "../../lib/grid-kit/names";
import type { Rng } from "../../core/rng";
import { defineSchema, type Values } from "../../core/schema";
import type { Format, PuzzleDef, Rating } from "../../core/types";
import { CROSS_SOLUTIONS, OCTAGON_SOLUTIONS } from "./known";
import { HOLE, OBST, PEG, jumps, type Jump } from "./solver";

export const params = defineSchema({
  board: {
    type: "enum", label: "board", default: "cross7x7",
    options: [
      { value: "cross7x7", label: "cross 7×7 (English)" },
      { value: "cross5x7", label: "cross 5×7" },
      { value: "cross5x9", label: "cross 5×9" },
      { value: "cross7x9", label: "cross 7×9" },
      { value: "cross9x9", label: "cross 9×9" },
      { value: "octagon", label: "octagon 7×7 (French)" },
      { value: "random", label: "random shape" },
    ],
  },
  width: { type: "int", label: "width", default: 7, min: 4, max: 11, when: (v) => v.board === "random" },
  height: { type: "int", label: "height", default: 7, min: 4, max: 11, when: (v) => v.board === "random" },
});

export interface PegsPuzzle {
  w: number;
  h: number;
  /** Row-major: 0 hole, 1 peg, 2 outside the board. */
  grid: number[];
  /** Jumps (from, to) that leave one peg, when known. */
  solution?: [number, number][];
}

export interface PegsState {
  grid: number[];
  moves: number;
}

/** Jump the peg at `from` over its neighbor into the hole at `to`, two cells away in a straight line. */
export type PegsAction = { type: "jump"; from: number; to: number };

export interface PegsFocus {
  from?: number;
  to?: number;
  over?: number;
  cells?: number[];
}

export interface PegsInteraction {
  /** Picked-up peg, or -1. */
  held: number;
  cursor: number;
}

export { cellAt };
export const pegCount = (grid: readonly number[]) => grid.reduce((a, v) => a + (v === PEG ? 1 : 0), 0);

export function jumpFor(p: Pick<PegsPuzzle, "w" | "h">, grid: readonly number[], from: number, to: number): Jump | null {
  return jumps(p.w, p.h, grid).find((j) => j.from === from && j.to === to) ?? null;
}

export function crossGrid(w: number, h: number): number[] {
  const out: number[] = [];
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const cx = Math.abs(x - Math.floor(w / 2)), cy = Math.abs(y - Math.floor(h / 2));
    out.push(cx === 0 && cy === 0 ? HOLE : cx > 1 && cy > 1 ? OBST : PEG);
  }
  return out;
}

function octagonGrid(hole: number): number[] {
  const out: number[] = [];
  for (let y = 0; y < 7; y++) for (let x = 0; x < 7; x++) out.push(Math.abs(x - 3) + Math.abs(y - 3) > 4 ? OBST : PEG);
  out[hole] = HOLE;
  return out;
}

/** The eight symmetries of a 7×7 square, as cell maps. */
const SYMMETRIES: ((x: number, y: number) => [number, number])[] = [
  (x, y) => [x, y], (x, y) => [6 - y, x], (x, y) => [6 - x, 6 - y], (x, y) => [y, 6 - x],
  (x, y) => [6 - x, y], (x, y) => [x, 6 - y], (x, y) => [y, x], (x, y) => [6 - y, 6 - x],
];

/** Starting holes that leave the French board solvable, by class: two from a corner peg, two from center, one from center. */
const OCTAGON_HOLES: [number, number][][] = [
  [[4, 0], [2, 0], [4, 6], [2, 6], [0, 4], [0, 2], [6, 4], [6, 2]],
  [[5, 3], [1, 3], [3, 5], [3, 1]],
  [[4, 3], [2, 3], [3, 4], [3, 2]],
];

function octagon(rng: Rng): PegsPuzzle {
  const cls = rng.int(3);
  const [hx, hy] = rng.pick(OCTAGON_HOLES[cls]!);
  const hole = hy * 7 + hx;
  const [rx, ry] = OCTAGON_HOLES[cls]![0]!;
  const sym = SYMMETRIES.find((f) => { const [x, y] = f(rx, ry); return x === hx && y === hy; })!;
  const map = (c: number) => { const [x, y] = sym(c % 7, Math.floor(c / 7)); return y * 7 + x; };
  const solution = OCTAGON_SOLUTIONS[cls]!.map(([a, b]) => [map(a), map(b)] as [number, number]);
  return { w: 7, h: 7, grid: octagonGrid(hole), solution };
}

/**
 * A random shape built backwards from one peg in the middle: each step un-jumps a peg, preferring
 * steps that stay on the board so far, so the shape grows only as needed. Retries until the shape
 * reaches all four edges.
 */
function randomShape(w: number, h: number, rng: Rng): PegsPuzzle {
  for (;;) {
    const grid = Array.from({ length: w * h }, () => OBST);
    const centre = Math.floor(h / 2) * w + Math.floor(w / 2);
    grid[centre] = PEG;
    const undone: [number, number][] = [];
    for (let n = 0; ; n++) {
      const maxCost = n < (w * h) / 2 ? 2 : 1;
      let best: { at: number; mid: number; far: number }[] = [];
      let bestCost = 3;
      for (let c = 0; c < w * h; c++) {
        if (grid[c] !== PEG) continue;
        const x = c % w, y = Math.floor(c / w);
        for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]] as const) {
          const x2 = x + 2 * dx, y2 = y + 2 * dy;
          if (x2 < 0 || y2 < 0 || x2 >= w || y2 >= h) continue;
          const mid = c + dy * w + dx, far = y2 * w + x2;
          if (grid[mid] === PEG || grid[far] === PEG) continue;
          const cost = (grid[mid] === OBST ? 1 : 0) + (grid[far] === OBST ? 1 : 0);
          if (cost > maxCost || cost > bestCost) continue;
          if (cost < bestCost) { bestCost = cost; best = []; }
          best.push({ at: c, mid, far });
        }
      }
      if (!best.length) break;
      const m = rng.pick(best);
      grid[m.at] = HOLE;
      grid[m.mid] = PEG;
      grid[m.far] = PEG;
      undone.push([m.far, m.at]);
    }
    let edges = 0;
    for (let c = 0; c < w * h; c++) {
      if (grid[c] === OBST) continue;
      const x = c % w, y = Math.floor(c / w);
      if (x === 0) edges |= 1;
      if (x === w - 1) edges |= 2;
      if (y === 0) edges |= 4;
      if (y === h - 1) edges |= 8;
    }
    if (edges === 15) return { w, h, grid, solution: undone.reverse() };
  }
}

function generate(v: Values<typeof params>, rng: Rng): PegsPuzzle {
  if (v.board === "octagon") return octagon(rng);
  if (v.board === "random") return randomShape(v.width, v.height, rng);
  const m = /^cross(\d+)x(\d+)$/.exec(v.board)!;
  const w = Number(m[1]), h = Number(m[2]);
  return { w, h, grid: crossGrid(w, h), solution: CROSS_SOLUTIONS[`${w}x${h}`] };
}

// --- formats ---

function checked(w: number, h: number, grid: number[]): PegsPuzzle {
  if (!(w >= 1 && h >= 1 && w <= 30 && h <= 30)) throw new Error("size out of range");
  if (grid.length !== w * h) throw new Error(`expected ${w * h} cells, got ${grid.length}`);
  if (pegCount(grid) < 2) throw new Error("need at least two pegs");
  if (!grid.includes(HOLE)) throw new Error("need at least one hole");
  return { w, h, grid };
}

const LETTER = "HPO";
const SGT_RE = /^(\d+)(?:x(\d+))?[a-z]*:([PHO]+)$/;

/** Simon Tatham's Pegs game id: `WxH[type]:` then P (peg), H (hole) or O (off the board) per cell. */
export const sgtFormat: Format<PegsPuzzle> = {
  id: "sgt",
  label: "sgt game id (WxH:PHO…)",
  detect: (t) => SGT_RE.test(t.trim()),
  parse(text) {
    const m = SGT_RE.exec(text.trim());
    if (!m) throw new Error("expected WxH:… with P, H and O, e.g. 3x1:PPH");
    const w = Number(m[1]), h = Number(m[2] ?? m[1]);
    return checked(w, h, [...m[3]!].map((c) => LETTER.indexOf(c)));
  },
  serialize: (p) => `${p.w}x${p.h}:${p.grid.map((v) => LETTER[v]).join("")}`,
};

/** One row per line: `o` peg, `.` hole, space or `#` off the board. */
export const gridFormat: Format<PegsPuzzle> = {
  id: "grid",
  label: "grid (o peg, . hole, # off the board)",
  detect: (t) => t.trim().includes("\n") && /^[o.#\s]+$/.test(t.replace(/^\n+|\n+$/g, "")),
  parse(text) {
    const rows = text.replace(/^\n+|\s+$/g, "").split(/\r?\n/);
    const w = Math.max(...rows.map((r) => r.length)), h = rows.length;
    const grid = rows.flatMap((r) => [...r.padEnd(w)].map((c) => (c === "o" ? PEG : c === "." ? HOLE : OBST)));
    return checked(w, h, grid);
  },
  serialize(p) {
    const rows: string[] = [];
    for (let y = 0; y < p.h; y++) rows.push(p.grid.slice(y * p.w, y * p.w + p.w).map((v) => (v === PEG ? "o" : v === HOLE ? "." : "#")).join(""));
    return rows.join("\n");
  },
};

function rate(p: PegsPuzzle): Rating {
  const n = pegCount(p.grid);
  return { label: `${n} pegs`, score: n };
}

export const pegs: PuzzleDef<PegsPuzzle, PegsState, PegsAction, PegsInteraction, typeof params> = {
  id: "pegs",
  name: "pegs",
  aliases: ["peg solitaire", "solo noble", "english solitaire", "brainvita"],
  tags: ["classic", "moves", "jumping"],
  description: "jump pegs over each other, removing the one jumped, until a single peg is left.",
  generatorVersion: 1,
  params,
  presets: [
    { label: "cross 7×7", params: { board: "cross7x7" } },
    { label: "cross 5×7", params: { board: "cross5x7" } },
    { label: "cross 9×9", params: { board: "cross9x9" } },
    { label: "octagon", params: { board: "octagon" } },
    { label: "random 5×5", params: { board: "random", width: 5, height: 5 } },
    { label: "random 7×7", params: { board: "random", width: 7, height: 7 } },
    { label: "random 9×9", params: { board: "random", width: 9, height: 9 } },
  ],
  generate,
  formats: [sgtFormat, gridFormat],
  init: (p) => ({ grid: p.grid.slice(), moves: 0 }),
  initInteraction: () => ({ held: -1, cursor: 0 }),
  reduce(p, s, a) {
    if (a.type !== "jump") return s;
    const j = jumpFor(p, s.grid, a.from, a.to);
    if (!j) return s;
    const grid = s.grid.slice();
    grid[j.from] = HOLE;
    grid[j.over] = HOLE;
    grid[j.to] = PEG;
    return { grid, moves: s.moves + 1 };
  },
  describeAction: (p, a) => `${cellAt(p, a.from)} → ${cellAt(p, a.to)}`,
  isSolved: (_p, s) => pegCount(s.grid) === 1,
  isLost: (p, s) => pegCount(s.grid) > 1 && jumps(p.w, p.h, s.grid).length === 0,
  rate,
  rules: () => [
    "a peg can jump over a peg right next to it (across an edge, not diagonally) into an empty hole just beyond; the jumped peg is removed.",
    "finish with a single peg left anywhere on the board.",
    "if no jump is possible with more than one peg left, the game is over (undo steps back).",
  ],
  describe: (p) => `${p.w}×${p.h}`,
};
