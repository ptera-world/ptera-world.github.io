import { isOrthoAdjacent, orthoPairs } from "../geometry";
import { pairRule } from "../rules";
import type { ConstraintSpec, ConstraintType, RenderCtx } from "../types";
import { midpoint } from "./draw";

export interface EdgeSpec extends ConstraintSpec { a: number; b: number }

const validEdge = (c: EdgeSpec, n: number): string | null =>
  [c.a, c.b].every((x) => Number.isInteger(x) && x >= 0 && x < n * n) && isOrthoAdjacent(n, c.a, c.b) ? null : "cells must be orthogonal neighbours";

export interface KropkiSpec extends EdgeSpec { color: "white" | "black" }

const kropkiOk = (color: string) => color === "white"
  ? (x: number, y: number) => Math.abs(x - y) === 1
  : (x: number, y: number) => x === 2 * y || y === 2 * x;

export const kropki: ConstraintType<KropkiSpec> = {
  type: "kropki",
  label: "kropki dot",
  rule: "a white dot joins consecutive digits; a black dot joins digits where one is double the other",
  kind: "clue",
  removable: true,
  validate: (c, n) => validEdge(c, n) ?? (c.color === "white" || c.color === "black" ? null : "colour must be white or black"),
  compile: (c, n) => ({ rules: [pairRule(n, c.a, c.b, `the ${c.color} dot`, kropkiOk(c.color), 2)] }),
  clues(sol, n, rng) {
    const out: KropkiSpec[] = [];
    for (const [a, b] of orthoPairs(n)) {
      const x = sol[a]!, y = sol[b]!;
      const colors = (["white", "black"] as const).filter((col) => kropkiOk(col)(x, y));
      if (colors.length) out.push({ type: "kropki", a, b, color: rng.pick(colors) });
    }
    return out;
  },
  cells: (c) => [c.a, c.b],
  render(c, ctx) {
    const [x, y] = midpoint(ctx, c.a, c.b);
    ctx.layer.over.append(ctx.svg("circle", { cx: x, cy: y, r: ctx.S * 0.12, class: `sdk-kropki sdk-kropki-${c.color}` }));
  },
};

export interface XvSpec extends EdgeSpec { sum: number }

export const xv: ConstraintType<XvSpec> = {
  type: "xv",
  label: "XV",
  rule: "digits joined by an X sum to 10; by a V, to 5",
  kind: "clue",
  removable: true,
  validate: (c, n) => validEdge(c, n) ?? (c.sum === 5 || c.sum === 10 ? null : "sum must be 5 or 10"),
  compile: (c, n) => ({ rules: [pairRule(n, c.a, c.b, c.sum === 10 ? "the X" : "the V", (x, y) => x + y === c.sum, 2)] }),
  clues: (sol, n) => orthoPairs(n).flatMap(([a, b]) => {
    const s = sol[a]! + sol[b]!;
    return s === 5 || s === 10 ? [{ type: "xv", a, b, sum: s }] : [];
  }),
  cells: (c) => [c.a, c.b],
  render(c, ctx) {
    const [x, y] = midpoint(ctx, c.a, c.b);
    edgeGlyph(ctx, x, y, c.sum === 10 ? "X" : "V", "sdk-xv");
  },
};

function edgeGlyph(ctx: RenderCtx, x: number, y: number, text: string, cls: string): void {
  const r = ctx.S * 0.16;
  ctx.layer.over.append(
    ctx.svg("rect", { x: x - r, y: y - r, width: 2 * r, height: 2 * r, rx: r * 0.4, class: "sdk-label-bg" }),
    ctx.svg("text", { x, y, class: cls }, text));
}

/** Value at `a` is less than value at `b`. */
export const unequal: ConstraintType<EdgeSpec> = {
  type: "unequal",
  label: "inequality",
  rule: "each sign points to the smaller of the two digits it sits between",
  kind: "clue",
  removable: true,
  validate: validEdge,
  compile: (c, n) => ({ rules: [pairRule(n, c.a, c.b, "the inequality", (x, y) => x < y, 1.8)] }),
  clues: (sol, n) => orthoPairs(n).map(([a, b]) => (sol[a]! < sol[b]! ? { type: "unequal", a, b } : { type: "unequal", a: b, b: a })),
  cells: (c) => [c.a, c.b],
  render(c, ctx) {
    const [mx, my] = midpoint(ctx, c.a, c.b);
    const [ax, ay] = ctx.center(c.a);
    const len = Math.hypot(mx - ax, my - ay);
    const ux = (ax - mx) / len, uy = (ay - my) / len;
    const s = ctx.S * 0.1;
    const tipX = mx + ux * s, tipY = my + uy * s;
    const backX = mx - ux * s, backY = my - uy * s;
    ctx.layer.over.append(ctx.svg("path", {
      d: `M${backX - uy * s * 1.3} ${backY + ux * s * 1.3}L${tipX} ${tipY}L${backX + uy * s * 1.3} ${backY - ux * s * 1.3}`,
      class: "sdk-unequal",
    }));
  },
};

export const edgeTypes = [kropki, xv, unequal];
