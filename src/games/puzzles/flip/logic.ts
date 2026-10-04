import type { Rng } from "../../core/rng";
import { defineSchema, type Values } from "../../core/schema";
import type { Format, Hint, PuzzleDef } from "../../core/types";

export const params = defineSchema({
  width: { type: "int", label: "width", default: 5, min: 2, max: 12 },
  height: { type: "int", label: "height", default: 5, min: 2, max: 12 },
  shape: {
    type: "enum", label: "neighbourhood", default: "cross",
    options: [
      { value: "cross", label: "cross (+)" },
      { value: "x", label: "diagonal (×)" },
      { value: "square", label: "square (3×3)" },
    ],
  },
  presses: { type: "int", label: "scramble presses (0 = max)", default: 0, min: 0, max: 144 },
});

export type Shape = "cross" | "x" | "square";

export interface FlipPuzzle {
  w: number;
  h: number;
  shape: Shape;
  /** Initial lights, row-major, 1 = lit. */
  lights: number[];
}

export interface FlipState {
  lights: number[];
}

export type FlipAction = { type: "press"; cell: number };

export interface FlipInteraction {
  cursor: number;
}

const OFFSETS: Record<Shape, [number, number][]> = {
  cross: [[0, 0], [1, 0], [-1, 0], [0, 1], [0, -1]],
  x: [[0, 0], [1, 1], [-1, -1], [1, -1], [-1, 1]],
  square: [[-1, -1], [0, -1], [1, -1], [-1, 0], [0, 0], [1, 0], [-1, 1], [0, 1], [1, 1]],
};

export function affected(p: Pick<FlipPuzzle, "w" | "h" | "shape">, cell: number): number[] {
  const x = cell % p.w, y = Math.floor(cell / p.w);
  const out: number[] = [];
  for (const [dx, dy] of OFFSETS[p.shape]) {
    const nx = x + dx, ny = y + dy;
    if (nx >= 0 && ny >= 0 && nx < p.w && ny < p.h) out.push(ny * p.w + nx);
  }
  return out;
}

function press(p: FlipPuzzle, lights: number[], cell: number): number[] {
  const next = lights.slice();
  for (const c of affected(p, cell)) next[c] = next[c]! ^ 1;
  return next;
}

/**
 * Minimal-weight set of presses that clears `lights`, or null if unsolvable.
 * GF(2) elimination; free variables enumerated when there are few, else set to 0.
 */
export function solvePresses(p: FlipPuzzle, lights: readonly number[]): number[] | null {
  const n = p.w * p.h;
  const rows: bigint[] = [];
  for (let c = 0; c < n; c++) {
    let row = 0n;
    for (let k = 0; k < n; k++) if (affected(p, k).includes(c)) row |= 1n << BigInt(k);
    if (lights[c]) row |= 1n << BigInt(n);
    rows.push(row);
  }
  const pivotCol: number[] = [];
  let r = 0;
  for (let col = 0; col < n && r < n; col++) {
    const bit = 1n << BigInt(col);
    let sel = -1;
    for (let i = r; i < n; i++) if (rows[i]! & bit) { sel = i; break; }
    if (sel < 0) continue;
    [rows[r], rows[sel]] = [rows[sel]!, rows[r]!];
    for (let i = 0; i < n; i++) if (i !== r && rows[i]! & bit) rows[i] = rows[i]! ^ rows[r]!;
    pivotCol.push(col);
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
  return best;
}

function generate(v: Values<typeof params>, rng: Rng): FlipPuzzle {
  const base = { w: v.width, h: v.height, shape: v.shape as Shape };
  const n = base.w * base.h;
  let lights = Array.from({ length: n }, () => 0);
  const p: FlipPuzzle = { ...base, lights };
  if (v.presses === 0) {
    for (let c = 0; c < n; c++) if (rng.bool()) lights = press(p, lights, c);
  } else {
    const cells = rng.shuffle([...Array(n).keys()]).slice(0, Math.min(v.presses, n));
    for (const c of cells) lights = press(p, lights, c);
  }
  if (lights.every((l) => l === 0)) lights = press(p, lights, rng.int(n));
  return { ...base, lights };
}

const textFormat: Format<FlipPuzzle> = {
  id: "text",
  label: "text (WxH:shape:bits)",
  detect: (t) => /^\d+x\d+:(cross|x|square):[01]+$/.test(t.trim()),
  parse(t) {
    const m = /^(\d+)x(\d+):(cross|x|square):([01]+)$/.exec(t.trim());
    if (!m) throw new Error("expected WxH:shape:bits, e.g. 3x3:cross:010111010");
    const w = Number(m[1]), h = Number(m[2]);
    if (w < 1 || h < 1 || w > 32 || h > 32) throw new Error("size out of range");
    const bits = m[4]!;
    if (bits.length !== w * h) throw new Error(`expected ${w * h} cells, got ${bits.length}`);
    return { w, h, shape: m[3] as Shape, lights: [...bits].map(Number) };
  },
  serialize: (p) => `${p.w}x${p.h}:${p.shape}:${p.lights.join("")}`,
};

export const flip: PuzzleDef<FlipPuzzle, FlipState, FlipAction, FlipInteraction, typeof params> = {
  id: "flip",
  name: "flip",
  description: "turn every light off. pressing a cell toggles it and its neighbours.",
  generatorVersion: 1,
  params,
  presets: [
    { label: "3×3", params: { width: 3, height: 3 } },
    { label: "5×5", params: { width: 5, height: 5 } },
    { label: "7×7 square", params: { width: 7, height: 7, shape: "square" } },
  ],
  generate,
  formats: [textFormat],
  init: (p) => ({ lights: p.lights.slice() }),
  initInteraction: (p) => ({ cursor: Math.floor(p.h / 2) * p.w + Math.floor(p.w / 2) }),
  reduce(p, s, a) {
    switch (a.type) {
      case "press":
        if (a.cell < 0 || a.cell >= p.w * p.h) return s;
        return { lights: press(p, s.lights, a.cell) };
      default:
        return s;
    }
  },
  isSolved: (_p, s) => s.lights.every((l) => l === 0),
  solve: (p) => ({ lights: p.lights.map(() => 0) }),
  hint(p, s): Hint<FlipAction> | null {
    const x = solvePresses(p, s.lights);
    if (!x) return null;
    const cell = x.indexOf(1);
    if (cell < 0) return null;
    return { message: `press (${(cell % p.w) + 1}, ${Math.floor(cell / p.w) + 1})`, focus: [cell], action: { type: "press", cell } };
  },
  rate(p) {
    const x = solvePresses(p, p.lights);
    if (!x) return null;
    const n = x.reduce((a, b) => a + b, 0);
    return { label: `${n} presses`, score: n };
  },
  describe: (p) => `${p.w}×${p.h} ${p.shape}`,
};
