import type { Rng } from "./rng";
import { defineSchema, type Values } from "./schema";
import type { PuzzleDef } from "./types";

/**
 * Minimal toggle puzzle for engine tests (not content; never registered): pressing a cell
 * toggles it and its orthogonal neighbors; solved when everything is off.
 */

const params = defineSchema({
  width: { type: "int", label: "width", default: 4, min: 1, max: 6 },
  height: { type: "int", label: "height", default: 4, min: 1, max: 6 },
});

export interface Board {
  w: number;
  h: number;
  lights: number[];
}

export type Press = { type: "press"; cell: number };

function affected(p: Pick<Board, "w" | "h">, cell: number): number[] {
  const x = cell % p.w, y = Math.floor(cell / p.w);
  return [[0, 0], [1, 0], [-1, 0], [0, 1], [0, -1]]
    .map(([dx, dy]) => [x + dx!, y + dy!] as const)
    .filter(([nx, ny]) => nx >= 0 && ny >= 0 && nx < p.w && ny < p.h)
    .map(([nx, ny]) => ny * p.w + nx);
}

function press(p: Board, lights: readonly number[], cell: number): number[] {
  const next = lights.slice();
  for (const c of affected(p, cell)) next[c] = next[c]! ^ 1;
  return next;
}

/** Presses (as a 0/1 mask per cell) that clear `lights`, by exhaustive search; boards up to 16 cells. */
export function solvePresses(p: Board, lights: readonly number[]): number[] | null {
  const n = p.w * p.h;
  if (n > 16) throw new Error("fixture solver handles at most 16 cells");
  for (let m = 0; m < 1 << n; m++) {
    let l = lights.slice();
    for (let c = 0; c < n; c++) if ((m >> c) & 1) l = press(p, l, c);
    if (l.every((v) => v === 0)) return Array.from({ length: n }, (_, c) => (m >> c) & 1);
  }
  return null;
}

export const toggle: PuzzleDef<Board, { lights: number[] }, Press, void, typeof params> = {
  id: "test-toggle",
  name: "test toggle",
  generatorVersion: 1,
  params,
  generate(v: Values<typeof params>, rng: Rng) {
    const base = { w: v.width, h: v.height };
    let lights = Array.from({ length: base.w * base.h }, () => 0);
    for (let c = 0; c < lights.length; c++) if (rng.bool()) lights = press({ ...base, lights }, lights, c);
    if (lights.every((l) => l === 0)) lights = press({ ...base, lights }, lights, 0);
    return { ...base, lights };
  },
  formats: [{
    id: "text",
    label: "WxH:bits",
    parse(t) {
      const m = /^(\d+)x(\d+):([01]+)$/.exec(t.trim());
      if (!m) throw new Error("expected WxH:bits");
      const w = Number(m[1]), h = Number(m[2]);
      if (m[3]!.length !== w * h) throw new Error("wrong cell count");
      return { w, h, lights: [...m[3]!].map(Number) };
    },
    serialize: (p) => `${p.w}x${p.h}:${p.lights.join("")}`,
  }],
  init: (p) => ({ lights: p.lights.slice() }),
  reduce: (p, s, a) => (a.type === "press" && a.cell >= 0 && a.cell < p.w * p.h ? { lights: press(p, s.lights, a.cell) } : s),
  isSolved: (_p, s) => s.lights.every((l) => l === 0),
  solve(p, s) {
    const x = solvePresses(p, s.lights);
    return x ? { moves: x.flatMap((v, cell): Press[] => (v ? [{ type: "press", cell }] : [])) } : null;
  },
};
