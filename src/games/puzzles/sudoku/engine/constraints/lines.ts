import type { Rng } from "../../../../core/rng";
import { isKingAdjacent, randomPath } from "../geometry";
import { linearRule, pairRule, predicateRule } from "../rules";
import type { ConstraintSpec, ConstraintType, Rule } from "../types";
import { polyline } from "./draw";

export interface LineSpec extends ConstraintSpec { cells: number[] }

function validPath(cells: unknown, n: number, min: number): string | null {
  if (!Array.isArray(cells) || cells.length < min) return `needs at least ${min} cells`;
  if (!cells.every((c) => Number.isInteger(c) && c >= 0 && c < n * n)) return "cell out of range";
  if (new Set(cells).size !== cells.length) return "repeated cell";
  for (let i = 1; i < cells.length; i++) if (!isKingAdjacent(n, cells[i - 1], cells[i])) return "cells must touch in order";
  return null;
}

const chain = (n: number, cells: readonly number[], label: string, ok: (x: number, y: number) => boolean, difficulty: number): Rule[] =>
  cells.slice(1).map((b, i) => pairRule(n, cells[i]!, b, label, ok, difficulty));

/** Up to `count` non-overlapping random paths of at least minLen cells, each accepted by `step`. */
function pathClues(n: number, rng: Rng, count: number, minLen: number, maxLen: number, step: (path: readonly number[], next: number) => boolean, starts: (c: number) => boolean, finish: (path: number[]) => number[] | null = (p) => p): number[][] {
  const used = new Set<number>();
  const out: number[][] = [];
  for (const start of rng.shuffle([...Array(n * n).keys()])) {
    if (out.length >= count) break;
    if (used.has(start) || !starts(start)) continue;
    const raw = randomPath(n, rng, start, maxLen, used, step);
    const path = finish(raw);
    if (!path || path.length < minLen) continue;
    for (const c of path) used.add(c);
    out.push(path);
  }
  return out;
}

const lineCount = (n: number, o: Readonly<Record<string, unknown>> | undefined) => Math.max(1, Math.round(n * Number(o?.density ?? 0.7)));

export const thermo: ConstraintType<LineSpec> = {
  type: "thermo",
  label: "thermometer",
  rule: "digits strictly increase from a thermometer's bulb",
  kind: "clue",
  removable: true,
  validate: (c, n) => validPath(c.cells, n, 2),
  compile: (c, n) => ({ rules: chain(n, c.cells, "the thermometer", (x, y) => x < y, 2) }),
  clues: (sol, n, rng, o) => pathClues(n, rng, lineCount(n, o), 3, n, (p, c) => sol[c]! > sol[p[p.length - 1]!]!, (c) => sol[c]! <= Math.ceil(n / 3))
    .map((cells) => ({ type: "thermo", cells })),
  cells: (c) => c.cells,
  render(c, ctx) {
    const [x, y] = ctx.center(c.cells[0]!);
    ctx.layer.under.append(
      ctx.svg("path", { d: polyline(ctx, c.cells), class: "sdk-thermo" }),
      ctx.svg("circle", { cx: x, cy: y, r: ctx.S * 0.36, class: "sdk-thermo-bulb" }));
  },
};

export const whispers: ConstraintType<LineSpec> = {
  type: "whispers",
  label: "whisper line",
  rule: "neighbouring digits on a green line differ by at least half the grid size, rounded up (5 on 9×9)",
  kind: "clue",
  removable: true,
  validate: (c, n) => validPath(c.cells, n, 2),
  compile(c, n) {
    const gap = Math.ceil(n / 2);
    return { rules: chain(n, c.cells, "the whisper line", (x, y) => Math.abs(x - y) >= gap, 2) };
  },
  clues(sol, n, rng, o) {
    const gap = Math.ceil(n / 2);
    return pathClues(n, rng, lineCount(n, o), 3, n, (p, c) => Math.abs(sol[c]! - sol[p[p.length - 1]!]!) >= gap, () => true)
      .map((cells) => ({ type: "whispers", cells }));
  },
  cells: (c) => c.cells,
  render: (c, ctx) => void ctx.layer.under.append(ctx.svg("path", { d: polyline(ctx, c.cells), class: "sdk-whispers" })),
};

export const renban: ConstraintType<LineSpec> = {
  type: "renban",
  label: "renban line",
  rule: "a purple line holds a set of consecutive digits in any order, without repeats",
  kind: "clue",
  removable: true,
  validate: (c, n) => validPath(c.cells, n, 2) ?? (c.cells.length > n ? "too long" : null),
  compile(c, n) {
    const k = c.cells.length;
    const span = (v: readonly number[]) => {
      let lo = Infinity, hi = -Infinity;
      for (const x of v) if (x) {
        lo = Math.min(lo, x);
        hi = Math.max(hi, x);
      }
      return hi - lo;
    };
    return {
      houses: [{ cells: c.cells, kind: "line", label: "the renban line" }],
      rules: [predicateRule(n, c.cells, {
        label: "the renban line",
        distinct: true,
        difficulty: 2.5,
        accept: (v) => Math.max(...v) - Math.min(...v) === k - 1,
        feasible: (v) => !v.some((x) => x) || span(v) <= k - 1,
      })],
    };
  },
  clues(sol, n, rng, o) {
    return pathClues(n, rng, lineCount(n, o), 3, Math.min(n, 6), (p, c) => {
      const vals = [...p.map((x) => sol[x]!), sol[c]!];
      return new Set(vals).size === vals.length && Math.max(...vals) - Math.min(...vals) <= 5;
    }, () => true, (p) => {
      for (let len = p.length; len >= 3; len--) {
        const v = p.slice(0, len).map((x) => sol[x]!);
        if (Math.max(...v) - Math.min(...v) === len - 1) return p.slice(0, len);
      }
      return null;
    }).map((cells) => ({ type: "renban", cells }));
  },
  cells: (c) => c.cells,
  render: (c, ctx) => void ctx.layer.under.append(ctx.svg("path", { d: polyline(ctx, c.cells), class: "sdk-renban" })),
};

export interface ArrowSpec extends ConstraintSpec { circle: number; cells: number[] }

export const arrow: ConstraintType<ArrowSpec> = {
  type: "arrow",
  label: "arrow",
  rule: "digits along an arrow sum to the digit in its circle (digits may repeat)",
  kind: "clue",
  removable: true,
  validate: (c, n) => validPath([c.circle, ...(Array.isArray(c.cells) ? c.cells : [])], n, 2),
  compile(c, n) {
    const cells = [c.circle, ...c.cells];
    return {
      rules: [linearRule(n, cells, cells.map((_, i) => (i ? 1 : -1)), 0, "the arrow", 2.5)],
    };
  },
  clues(sol, n, rng, o) {
    const used = new Set<number>();
    const out: ArrowSpec[] = [];
    const want = lineCount(n, o);
    for (const circle of rng.shuffle([...Array(n * n).keys()])) {
      if (out.length >= want) break;
      const v = sol[circle]!;
      if (used.has(circle) || v < 3) continue;
      const blocked = new Set([...used, circle]);
      const starts = rng.shuffle([...Array(n * n).keys()].filter((c) => isKingAdjacent(n, c, circle) && !blocked.has(c) && sol[c]! < v));
      for (const s of starts) {
        const path = randomPath(n, rng, s, 4, blocked, (p, c) => p.reduce((a, x) => a + sol[x]!, 0) + sol[c]! <= v);
        let sum = 0;
        const cut = path.findIndex((c) => (sum += sol[c]!) === v);
        if (cut >= 1) {
          const cells = path.slice(0, cut + 1);
          for (const c of [circle, ...cells]) used.add(c);
          out.push({ type: "arrow", circle, cells });
          break;
        }
      }
    }
    return out;
  },
  cells: (c) => [c.circle, ...c.cells],
  render(c, ctx) {
    const S = ctx.S;
    const [cx, cy] = ctx.center(c.circle);
    const [fx, fy] = ctx.center(c.cells[0]!);
    const len = Math.hypot(fx - cx, fy - cy);
    const sx = cx + ((fx - cx) / len) * S * 0.38, sy = cy + ((fy - cy) / len) * S * 0.38;
    const pts = c.cells.map((x) => ctx.center(x));
    const [ex, ey] = pts[pts.length - 1]!;
    const [px, py] = pts.length > 1 ? pts[pts.length - 2]! : [cx, cy];
    const al = Math.hypot(ex - px, ey - py);
    const ux = (ex - px) / al, uy = (ey - py) / al;
    const h = S * 0.22;
    const head = `M${ex - ux * h - uy * h * 0.7} ${ey - uy * h + ux * h * 0.7}L${ex} ${ey}L${ex - ux * h + uy * h * 0.7} ${ey - uy * h - ux * h * 0.7}`;
    ctx.layer.under.append(
      ctx.svg("circle", { cx, cy, r: S * 0.38, class: "sdk-arrow-circle" }),
      ctx.svg("path", { d: `M${sx} ${sy}${pts.map(([x, y]) => `L${x} ${y}`).join("")}${head}`, class: "sdk-arrow" }));
  },
};

export const lineTypes = [thermo, arrow, whispers, renban];
