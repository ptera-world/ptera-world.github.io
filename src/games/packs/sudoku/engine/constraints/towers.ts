import { predicateRule } from "../rules";
import type { ConstraintSpec, ConstraintType } from "../types";
import { sideMargins } from "./cages";

export type Side = "top" | "bottom" | "left" | "right";

/** Seen from `side` at row/column `index`, exactly `count` towers are visible (taller ones hide shorter). */
export interface TowersSpec extends ConstraintSpec { side: Side; index: number; count: number }

export function sightLine(n: number, side: Side, i: number): number[] {
  const k = [...Array(n).keys()];
  switch (side) {
    case "top": return k.map((r) => r * n + i);
    case "bottom": return k.map((r) => (n - 1 - r) * n + i);
    case "left": return k.map((c) => i * n + c);
    case "right": return k.map((c) => i * n + (n - 1 - c));
  }
}

function clueAt(n: number, side: Side, i: number): [number, number] {
  switch (side) {
    case "top": return [-1, i];
    case "bottom": return [n, i];
    case "left": return [i, -1];
    case "right": return [i, n];
  }
}

export function visible(values: readonly number[]): number {
  let max = 0, seen = 0;
  for (const v of values) if (v > max) {
    max = v;
    seen++;
  }
  return seen;
}

export const towers: ConstraintType<TowersSpec> = {
  type: "towers",
  label: "skyscraper clue",
  rule: "digits are building heights; an outside clue counts the buildings visible from that side, taller ones hiding shorter ones",
  kind: "clue",
  removable: true,
  validate: (c, n) => (["top", "bottom", "left", "right"].includes(c.side) && Number.isInteger(c.index) && c.index >= 0 && c.index < n
    && Number.isInteger(c.count) && c.count >= 1 && c.count <= n ? null : "bad clue position or count"),
  compile(c, n) {
    const cells = sightLine(n, c.side, c.index);
    return {
      rules: [predicateRule(n, cells, {
        label: `the ${c.count} clue`,
        distinct: true,
        difficulty: 2,
        accept: (v) => visible(v) === c.count,
        feasible(v) {
          let max = 0, seen = 0, i = 0;
          for (; i < v.length && v[i]; i++) if (v[i]! > max) {
            max = v[i]!;
            seen++;
          }
          if (i === v.length) return seen === c.count;
          if (seen > c.count) return false;
          return seen + Math.min(v.length - i, n - max) >= c.count;
        },
      })],
    };
  },
  clues: (sol, n) => (["top", "bottom", "left", "right"] as const).flatMap((side) =>
    [...Array(n).keys()].map((index) => ({ type: "towers", side, index, count: visible(sightLine(n, side, index).map((c) => sol[c]!)) }))),
  cells: (c, n) => sightLine(n, c.side, c.index),
  margin: (c, n) => sideMargins(...clueAt(n, c.side, c.index), n),
  render(c, ctx) {
    const [x, y] = ctx.at(...clueAt(ctx.n, c.side, c.index));
    ctx.layer.outside.append(ctx.svg("text", { x, y, class: "sdk-outside sdk-towers" }, String(c.count)));
  },
};
