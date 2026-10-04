import { boxIds, connected, KING, KNIGHT, orthoPairs, pairs } from "../geometry";
import { pairRule } from "../rules";
import { cellName, cellSpan, colName, type ConstraintSpec, type ConstraintType, type House } from "../types";

const range = (n: number) => [...Array(n).keys()];

export const latin: ConstraintType = {
  type: "latin",
  label: "rows and columns",
  rule: "every row and column contains each digit once",
  kind: "global",
  compile(_c, n) {
    const houses: House[] = [];
    for (const r of range(n)) houses.push({ cells: range(n).map((c) => r * n + c), kind: "row", label: `row ${r + 1}` });
    for (const c of range(n)) houses.push({ cells: range(n).map((r) => r * n + c), kind: "col", label: `column ${colName(c)}` });
    return { houses };
  },
};

function regionHouses(n: number, ids: readonly number[], name: (id: number, cells: number[]) => string): House[] {
  const out: House[] = [];
  for (const id of range(n)) {
    const cells = ids.flatMap((v, c) => (v === id ? [c] : []));
    out.push({ cells, kind: "box", label: name(id, cells) });
  }
  return out;
}

const VERT = [[], ["middle"], ["top", "bottom"], ["top", "middle", "bottom"]];
const HORZ = [[], ["middle"], ["left", "right"], ["left", "middle", "right"]];

/** "the top-left box", "the center box", … where the boxes form at most 3×3; else by a corner cell. */
function boxName(n: number, w: number, h: number): (id: number, cells: number[]) => string {
  const across = n / w, down = n / h;
  return (id, cells) => {
    const v = VERT[down]?.[Math.floor(id / across)], hz = HORZ[across]?.[id % across];
    if (v === undefined || hz === undefined) return `the box at ${cellName(n, cells[0]!)}`;
    const where = v === "middle" && hz === "middle" ? "center" : v === "middle" ? hz : hz === "middle" ? v : `${v}-${hz}`;
    return `the ${where} box`;
  };
}

export interface BoxesSpec extends ConstraintSpec { w: number; h: number }

export const boxes: ConstraintType<BoxesSpec> = {
  type: "boxes",
  label: "boxes",
  rule: "every box contains each digit once",
  kind: "global",
  validate: (c, n) => (Number.isInteger(c.w) && Number.isInteger(c.h) && c.w * c.h === n && n % c.w === 0 ? null : "box size must tile the grid"),
  compile: (c, n) => ({ houses: regionHouses(n, boxIds(n, c.w, c.h), boxName(n, c.w, c.h)) }),
};

export interface RegionsSpec extends ConstraintSpec { ids: number[] }

export const regions: ConstraintType<RegionsSpec> = {
  type: "regions",
  label: "irregular regions",
  rule: "every outlined region contains each digit once",
  kind: "global",
  validate(c, n) {
    if (!Array.isArray(c.ids) || c.ids.length !== n * n) return `expected ${n * n} region ids`;
    for (const id of range(n)) {
      const cells = c.ids.flatMap((v, i) => (v === id ? [i] : []));
      if (cells.length !== n) return `region ${id + 1} has ${cells.length} cells, expected ${n}`;
      if (!connected(n, cells)) return `region ${id + 1} isn't connected`;
    }
    return null;
  },
  compile: (c, n) => ({ houses: regionHouses(n, c.ids, (_id, cells) => `the region with ${cellName(n, cells[0]!)}`) }),
};

export interface DiagonalSpec extends ConstraintSpec { anti?: boolean }

export const diagonal: ConstraintType<DiagonalSpec> = {
  type: "diagonal",
  label: "diagonal",
  rule: "each marked diagonal contains each digit once",
  kind: "global",
  compile: (c, n) => ({
    houses: [{
      cells: range(n).map((i) => i * n + (c.anti ? n - 1 - i : i)),
      kind: "diagonal",
      label: c.anti ? "the anti-diagonal" : "the main diagonal",
    }],
  }),
  cells: (c, n) => range(n).map((i) => i * n + (c.anti ? n - 1 - i : i)),
  render(c, ctx) {
    const { n, S } = ctx;
    const [x1, x2] = c.anti ? [n * S, 0] : [0, n * S];
    ctx.layer.under.append(ctx.svg("line", { x1, y1: 0, x2, y2: n * S, class: "sdk-diagonal" }));
  },
};

export const antiknight: ConstraintType = {
  type: "antiknight",
  label: "anti-knight",
  rule: "cells a chess knight's move apart can't hold the same digit",
  kind: "global",
  compile: (_c, n) => ({ neq: pairs(n, KNIGHT) }),
};

export const antiking: ConstraintType = {
  type: "antiking",
  label: "anti-king",
  rule: "diagonally touching cells can't hold the same digit",
  kind: "global",
  compile: (_c, n) => ({ neq: pairs(n, KING) }),
};

export const nonconsecutive: ConstraintType = {
  type: "nonconsecutive",
  label: "non-consecutive",
  rule: "orthogonally touching cells can't hold consecutive digits",
  logic: { name: "non-consecutive logic", level: 2, description: "a placed digit rules out its neighbors on both sides in the four touching cells: a 5 means no 4 or 6 next to it. a cell that can only be 4 or 6 also forbids 5 around it." },
  kind: "global",
  compile: (_c, n) => ({
    rules: orthoPairs(n).map(([a, b]) => pairRule(n, a, b, `the non-consecutive rule between ${cellSpan(n, [a, b])}`, (x, y) => Math.abs(x - y) !== 1, 2)),
  }),
};

export const gridTypes = [latin, boxes, regions, diagonal, antiknight, antiking, nonconsecutive];
