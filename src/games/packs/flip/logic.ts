import type { Ids } from "../../core/commands";
import { featureTests } from "../../core/define";
import type { Rng } from "../../core/rng";
import { defineSchema, formatCells, parseCells, type CellOffset, type Values } from "../../core/schema";
import type { Format, Hint, PuzzleDef } from "../../core/types";
import { cellName } from "../../lib/grid-kit/names";

export type Grid = "square" | "hex";

const SHAPES = {
  cross: "-1,0;0,-1;0,0;0,1;1,0",
  x: "-1,-1;-1,1;0,0;1,-1;1,1",
  square: "-1,-1;-1,0;-1,1;0,-1;0,0;0,1;1,-1;1,0;1,1",
  hex: "-1,0;-1,1;0,-1;0,0;0,1;1,-1;1,0",
} as const;

export type ShapeName = keyof typeof SHAPES;

export const params = defineSchema({
  width: { type: "int", label: "width", default: 5, min: 2, max: 12 },
  height: { type: "int", label: "height", default: 5, min: 2, max: 12 },
  grid: {
    type: "enum", label: "cells", default: "square",
    options: [{ value: "square", label: "square" }, { value: "hex", label: "hexagons" }],
  },
  neighborhood: {
    type: "enum", label: "neighborhood", default: "cross",
    when: (v) => v.grid === "square",
    options: [
      { value: "cross", label: "cross (+)" },
      { value: "x", label: "diagonal (×)" },
      { value: "square", label: "square (3×3)" },
      { value: "drawn", label: "draw your own" },
    ],
  },
  hexNeighborhood: {
    type: "enum", label: "neighborhood", default: "hex",
    when: (v) => v.grid === "hex",
    options: [{ value: "hex", label: "cell and its 6 neighbors" }, { value: "drawn", label: "draw your own" }],
  },
  drawn: {
    type: "cells", label: "pattern", default: SHAPES.cross, radius: 2, layout: "square",
    when: (v) => v.grid === "square" && v.neighborhood === "drawn",
  },
  drawnHex: {
    type: "cells", label: "pattern", default: SHAPES.hex, radius: 2, layout: "hex",
    when: (v) => v.grid === "hex" && v.hexNeighborhood === "drawn",
  },
  holes: { type: "int", label: "holes (% of cells)", default: 0, min: 0, max: 40 },
  presses: { type: "int", label: "scramble presses (0 = max)", default: 0, min: 0, max: 144 },
});

export interface FlipPuzzle {
  w: number;
  h: number;
  grid: Grid;
  /** Row-major, 1 = no cell there. Hex boards are odd-r rows (odd rows drawn half a cell right). */
  holes: number[];
  /** Cells a press toggles, relative to the pressed cell: (dx, dy) on square boards, axial (dq, dr) on hex. */
  offsets: CellOffset[];
  /** Initial lights, row-major, 1 = lit; 0 at holes. */
  lights: number[];
}

export interface FlipState {
  lights: number[];
}

export type FlipAction = { type: "press"; cell: number };

export interface FlipInteraction {
  cursor: number;
}

type Geometry = Pick<FlipPuzzle, "w" | "h" | "grid" | "holes">;

/** Board position of a cell in the offsets' coordinates: (col, row) on square boards, axial (q, r) on hex. */
export function toCoord(p: Pick<FlipPuzzle, "w" | "grid">, cell: number): CellOffset {
  const x = cell % p.w, y = Math.floor(cell / p.w);
  return p.grid === "hex" ? [x - (y - (y & 1)) / 2, y] : [x, y];
}

/** The real cell at a position, or -1 when it is off the board or a hole. */
export function cellAt(p: Geometry, a: number, b: number): number {
  const y = b;
  const x = p.grid === "hex" ? a + (b - (b & 1)) / 2 : a;
  if (x < 0 || y < 0 || x >= p.w || y >= p.h) return -1;
  const cell = y * p.w + x;
  return p.holes[cell] ? -1 : cell;
}

export function affected(p: Geometry & Pick<FlipPuzzle, "offsets">, cell: number): number[] {
  if (p.holes[cell]) return [];
  const [a, b] = toCoord(p, cell);
  const out: number[] = [];
  for (const [da, db] of p.offsets) {
    const c = cellAt(p, a + da, b + db);
    if (c >= 0) out.push(c);
  }
  return out;
}

function press(p: FlipPuzzle, lights: number[], cell: number): number[] {
  const next = lights.slice();
  for (const c of affected(p, cell)) next[c] = next[c]! ^ 1;
  return next;
}

/** The named shape whose offsets these are on this grid, or "drawn". */
export function shapeName(p: Pick<FlipPuzzle, "grid" | "offsets">): ShapeName | "drawn" {
  const key = formatCells(p.offsets);
  const names: ShapeName[] = p.grid === "hex" ? ["hex"] : ["cross", "x", "square"];
  return names.find((n) => SHAPES[n] === key) ?? "drawn";
}

/**
 * Minimal-weight set of presses (indexed by cell, 0 at holes) that clears `lights`, or null if
 * unsolvable. GF(2) elimination; free variables enumerated when there are few, else set to 0.
 */
export function solvePresses(p: FlipPuzzle, lights: readonly number[]): number[] | null {
  const total = p.w * p.h;
  const vars = [...Array(total).keys()].filter((c) => !p.holes[c]);
  const n = vars.length;
  const col = new Map(vars.map((c, k) => [c, k]));
  const rows: bigint[] = Array.from({ length: n }, () => 0n);
  vars.forEach((c, k) => {
    for (const t of affected(p, c)) rows[col.get(t)!]! |= 1n << BigInt(k);
  });
  vars.forEach((c, i) => { if (lights[c]) rows[i]! |= 1n << BigInt(n); });
  const pivotCol: number[] = [];
  let r = 0;
  for (let c = 0; c < n && r < n; c++) {
    const bit = 1n << BigInt(c);
    let sel = -1;
    for (let i = r; i < n; i++) if (rows[i]! & bit) { sel = i; break; }
    if (sel < 0) continue;
    [rows[r], rows[sel]] = [rows[sel]!, rows[r]!];
    for (let i = 0; i < n; i++) if (i !== r && rows[i]! & bit) rows[i] = rows[i]! ^ rows[r]!;
    pivotCol.push(c);
    r++;
  }
  const rhs = 1n << BigInt(n);
  for (let i = r; i < n; i++) if (rows[i]! & rhs) return null;
  const pivots = new Set(pivotCol);
  const free = [...Array(n).keys()].filter((c) => !pivots.has(c));
  const tryFree = (mask: number): number[] => {
    const x = Array.from({ length: n }, () => 0);
    free.forEach((c, i) => { x[c] = (mask >> i) & 1; });
    for (let i = r - 1; i >= 0; i--) {
      const row = rows[i]!;
      let v = row & rhs ? 1 : 0;
      for (const c of free) if (x[c] && row & (1n << BigInt(c))) v ^= 1;
      x[pivotCol[i]!] = v;
    }
    return x;
  };
  const combos = free.length <= 12 ? 1 << free.length : 1;
  let best: number[] | null = null;
  let bestW = Infinity;
  for (let m = 0; m < combos; m++) {
    const x = tryFree(m);
    const wgt = x.reduce((a, b) => a + b, 0);
    if (wgt < bestW) { best = x; bestW = wgt; }
  }
  if (!best) return null;
  const out = Array.from({ length: total }, () => 0);
  vars.forEach((c, k) => { out[c] = best![k]!; });
  return out;
}

/** The 8 chase directions as (x, y) with y pointing down: down, right, up, left, then the diagonals. */
const CHASE_DIRECTIONS: readonly (readonly [number, number])[] = [
  [0, 1], [1, 0], [0, -1], [-1, 0], [1, 1], [-1, 1], [1, -1], [-1, -1],
];
const CHASE_NAMES = ["down", "right", "up", "left", "down-right", "down-left", "up-right", "up-left"];

/**
 * How far along a direction a position lies, as an exact pair (a, b) meaning a + b·√3 (scaled by
 * the same factor for every position): hex drawn positions are x = q + r/2, y = r·√3/2.
 */
type Projection = readonly [number, number];

function project(grid: Grid, dir: readonly [number, number], a: number, b: number): Projection {
  return grid === "hex" ? [dir[0] * (2 * a + b), dir[1] * b] : [dir[0] * a + dir[1] * b, 0];
}

const SQRT3 = Math.sqrt(3);
const compare = (u: Projection, v: Projection): number =>
  u[0] === v[0] && u[1] === v[1] ? 0 : u[0] + u[1] * SQRT3 - (v[0] + v[1] * SQRT3);

export interface ChaseDirection {
  index: number;
  name: string;
  /** The only offset reaching furthest back against the direction. */
  back: CellOffset;
}

/** The first chase direction (in order) against which exactly one offset is extreme, or null. */
export function chaseDirection(p: Pick<FlipPuzzle, "grid" | "offsets">): ChaseDirection | null {
  for (let index = 0; index < CHASE_DIRECTIONS.length; index++) {
    const dir = CHASE_DIRECTIONS[index]!;
    let best: CellOffset | null = null;
    let bestProj: Projection | null = null;
    let ties = 0;
    for (const o of p.offsets) {
      const pr = project(p.grid, dir, o[0], o[1]);
      const c = bestProj ? compare(pr, bestProj) : -1;
      if (c < 0) { best = o; bestProj = pr; ties = 1; } else if (c === 0) ties++;
    }
    if (best && ties === 1) return { index, name: CHASE_NAMES[index]!, back: best };
  }
  return null;
}

export interface ChaseMove {
  /** The lit cell the press turns off. */
  light: number;
  press: number;
  /** Every real cell on the same line (same distance along the direction) as the light. */
  line: number[];
}

/** Presses that turn off the lit, chasable cells nearest the start of the chase, in cell order. */
export function chaseMoves(p: FlipPuzzle, lights: readonly number[]): ChaseMove[] {
  const d = chaseDirection(p);
  if (!d) return [];
  const dir = CHASE_DIRECTIONS[d.index]!;
  const proj = (cell: number): Projection => {
    const [a, b] = toCoord(p, cell);
    return project(p.grid, dir, a, b);
  };
  const found: { light: number; press: number; pr: Projection }[] = [];
  for (let c = 0; c < p.w * p.h; c++) {
    if (!lights[c] || p.holes[c]) continue;
    const [a, b] = toCoord(p, c);
    const from = cellAt(p, a - d.back[0], b - d.back[1]);
    if (from >= 0) found.push({ light: c, press: from, pr: proj(c) });
  }
  if (!found.length) return [];
  const first = found.reduce((m, f) => (compare(f.pr, m) < 0 ? f.pr : m), found[0]!.pr);
  return found.filter((f) => compare(f.pr, first) === 0).map((f) => ({
    light: f.light,
    press: f.press,
    line: [...Array(p.w * p.h).keys()].filter((c) => !p.holes[c] && compare(proj(c), f.pr) === 0),
  }));
}

export const chaseDirectionName = (p: Pick<FlipPuzzle, "grid" | "offsets">): string => chaseDirection(p)?.name ?? "";

function offsetsFor(v: Values<typeof params>): string {
  if (v.grid === "hex") return v.hexNeighborhood === "drawn" ? v.drawnHex : SHAPES.hex;
  return v.neighborhood === "drawn" ? v.drawn : SHAPES[v.neighborhood as "cross" | "x" | "square"];
}

function generate(v: Values<typeof params>, rng: Rng): FlipPuzzle {
  const w = v.width, h = v.height, n = w * h;
  const grid = v.grid as Grid;
  const offsets = parseCells(offsetsFor(v)) ?? [];
  const holes = Array.from({ length: n }, () => 0);
  const holeCount = Math.round((n * v.holes) / 100);
  if (holeCount > 0) for (const c of rng.shuffle([...Array(n).keys()]).slice(0, holeCount)) holes[c] = 1;
  const base = { w, h, grid, holes, offsets };
  const real = [...Array(n).keys()].filter((c) => !holes[c]);
  const lighting = real.filter((c) => affected({ ...base }, c).length > 0);
  if (!lighting.length) throw new Error("this neighborhood can't light any cell on this board");
  let lights = Array.from({ length: n }, () => 0);
  const p: FlipPuzzle = { ...base, lights };
  if (v.presses === 0) {
    for (const c of real) if (rng.bool()) lights = press(p, lights, c);
  } else {
    for (const c of rng.shuffle(real.slice()).slice(0, Math.min(v.presses, real.length))) lights = press(p, lights, c);
  }
  if (lights.every((l) => l === 0)) lights = press(p, lights, lighting[rng.int(lighting.length)]!);
  return { ...base, lights };
}

const NEW_FORMAT = /^(\d+)x(\d+):(square|hex):([-\d,;]*):([01-]+)$/;
const OLD_FORMAT = /^(\d+)x(\d+):(cross|x|square):([01]+)$/;

const textFormat: Format<FlipPuzzle> = {
  id: "text",
  label: "text (WxH:shape:bits or WxH:grid:offsets:cells)",
  detect: (t) => OLD_FORMAT.test(t.trim()) || NEW_FORMAT.test(t.trim()),
  parse(t) {
    const old = OLD_FORMAT.exec(t.trim());
    const m = old ?? NEW_FORMAT.exec(t.trim());
    if (!m) throw new Error("expected WxH:shape:bits, e.g. 3x3:cross:010111010, or WxH:grid:offsets:cells, e.g. 3x3:hex:0,0;1,0:01-110010");
    const w = Number(m[1]), h = Number(m[2]);
    if (w < 1 || h < 1 || w > 32 || h > 32) throw new Error("size out of range");
    const grid: Grid = old ? "square" : (m[3] as Grid);
    const offsets = parseCells(old ? SHAPES[m[3] as "cross" | "x" | "square"] : m[4]!);
    if (!offsets) throw new Error("offsets must be dx,dy pairs joined by ;");
    const cells = old ? m[4]! : m[5]!;
    if (cells.length !== w * h) throw new Error(`expected ${w * h} cells, got ${cells.length}`);
    return {
      w, h, grid, offsets,
      holes: [...cells].map((c) => (c === "-" ? 1 : 0)),
      lights: [...cells].map((c) => (c === "1" ? 1 : 0)),
    };
  },
  serialize(p) {
    const cells = p.lights.map((l, i) => (p.holes[i] ? "-" : String(l))).join("");
    const name = shapeName(p);
    if (p.grid === "square" && !p.holes.some(Boolean) && name !== "drawn") return `${p.w}x${p.h}:${name}:${cells}`;
    return `${p.w}x${p.h}:${p.grid}:${formatCells(p.offsets)}:${cells}`;
  },
};

const FEATURES = {
  /** Some chase direction has exactly one offset reaching furthest back against it. */
  "chase-direction": (p: Pick<FlipPuzzle, "grid" | "offsets">) => chaseDirection(p) !== null,
};

/** `cell` if it is a real cell, else the first real cell in row-major order. */
const firstReal = (p: FlipPuzzle, cell: number): number => (p.holes[cell] ? Math.max(0, p.holes.indexOf(0)) : cell);

const patternText: Record<ShapeName | "drawn", string> = {
  cross: "up, down, left, right",
  x: "the four diagonals",
  square: "all eight around it",
  hex: "the six around it",
  drawn: "the cells of its drawn pattern",
};

export const flip: PuzzleDef<FlipPuzzle, FlipState, FlipAction, FlipInteraction, typeof params> = {
  id: "flip",
  name: "lights out",
  aliases: ["flip", "merlin"],
  tags: ["logic", "grid", "toggle"],
  description: "turn every light off. pressing a cell toggles the cells of its pattern.",
  generatorVersion: 2,
  params,
  presets: [
    { label: "3×3", params: { width: 3, height: 3 } },
    { label: "5×5", params: { width: 5, height: 5 } },
    { label: "7×7 square", params: { width: 7, height: 7, neighborhood: "square" } },
    { label: "5×5 hex", params: { width: 5, height: 5, grid: "hex" } },
    { label: "6×6 holes", params: { width: 6, height: 6, holes: 15 } },
  ],
  generate,
  formats: [textFormat],
  init: (p) => ({ lights: p.lights.slice() }),
  initInteraction: (p) => ({ cursor: firstReal(p, Math.floor(p.h / 2) * p.w + Math.floor(p.w / 2)) }),
  reduce(p, s, a) {
    switch (a.type) {
      case "press":
        if (a.cell < 0 || a.cell >= p.w * p.h || p.holes[a.cell]) return s;
        return { lights: press(p, s.lights, a.cell) };
      default:
        return s;
    }
  },
  describeAction: (p, a) => `press ${cellName(p, a.cell)}`,
  isSolved: (_p, s) => s.lights.every((l) => l === 0),
  solve(p, s) {
    const x = solvePresses(p, s.lights);
    return x ? { moves: x.flatMap((v, cell): FlipAction[] => (v ? [{ type: "press", cell }] : [])) } : null;
  },
  hint(p, s): Hint<FlipAction> | null {
    if (s.lights.every((l) => l === 0)) return null;
    if (chaseMoves(p, s.lights).length) return null;
    if (chaseDirection(p)) {
      return {
        message: "the lights left can't be chased any further. press cells on the first line along the chase, then chase again: that changes which ones remain",
        focus: s.lights.flatMap((l, i) => (l ? [i] : [])),
      };
    }
    return { message: "every press toggles the same pattern, so pressing a cell twice undoes it and order doesn't matter" };
  },
  rate(p) {
    const x = solvePresses(p, p.lights);
    if (!x) return null;
    const n = x.reduce((a, b) => a + b, 0);
    return { label: `${n} presses`, score: n };
  },
  rules: (p) => [
    `pressing a cell toggles the cells around it (${patternText[shapeName(p)]}).`,
    ...(p.holes.some(Boolean) ? ["holes aren't cells: they never light up and can't be pressed."] : []),
    "turn every light off.",
  ],
  describe: (p) => `${p.w}×${p.h} ${shapeName(p)}${p.holes.some(Boolean) ? ` with ${p.holes.filter(Boolean).length} holes` : ""}`,
  features: featureTests(FEATURES),
};

declare module "../../core/types" {
  interface FeatureNames extends Ids<typeof FEATURES> {}
}
