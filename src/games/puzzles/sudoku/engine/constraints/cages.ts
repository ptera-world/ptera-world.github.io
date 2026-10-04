import type { Rng } from "../../../../core/rng";
import { offsets, ORTHO, partition, ray } from "../geometry";
import { linearRule, predicateRule, sumFeasible, sumRule } from "../rules";
import type { ConstraintSpec, ConstraintType, Margins, RenderCtx } from "../types";
import { anchorCell, cornerLabel, insetOutline } from "./draw";

function validCells(cells: unknown, n: number, max: number): string | null {
  if (!Array.isArray(cells) || cells.length === 0) return "needs at least one cell";
  if (cells.length > max) return `at most ${max} cells`;
  if (!cells.every((c) => Number.isInteger(c) && c >= 0 && c < n * n)) return "cell out of range";
  if (new Set(cells).size !== cells.length) return "repeated cell";
  return null;
}

/** Split `cells` minus `cell` into connected pieces. */
function splitOff(n: number, cells: readonly number[], cell: number): number[][] {
  const rest = new Set(cells.filter((c) => c !== cell));
  const pieces: number[][] = [];
  while (rest.size) {
    const start = rest.values().next().value as number;
    const piece = [start];
    rest.delete(start);
    for (let i = 0; i < piece.length; i++) {
      for (const d of offsets(n, piece[i]!, ORTHO)) if (rest.has(d)) {
        rest.delete(d);
        piece.push(d);
      }
    }
    pieces.push(piece.sort((a, b) => a - b));
  }
  return pieces;
}

function weighted(rng: Rng, weights: readonly number[]): number {
  const total = weights.reduce((a, b) => a + b, 0);
  let x = rng.next() * total;
  for (let i = 0; i < weights.length; i++) {
    x -= weights[i]!;
    if (x < 0) return i;
  }
  return weights.length - 1;
}

export interface KillerSpec extends ConstraintSpec { cells: number[]; sum?: number }

export const killer: ConstraintType<KillerSpec> = {
  type: "killer",
  label: "killer cage",
  rule: "digits in a dashed cage don't repeat and sum to its clue",
  kind: "clue",
  validate: (c, n) => validCells(c.cells, n, n) ?? (c.sum === undefined || Number.isInteger(c.sum) ? null : "sum must be a whole number"),
  compile(c, n) {
    const label = c.sum === undefined ? "cage" : `cage ${c.sum}`;
    return {
      houses: c.cells.length > 1 ? [{ cells: c.cells, kind: "cage", label }] : [],
      rules: c.sum === undefined ? [] : [sumRule(n, c.cells, c.sum, `the ${c.sum} cage`, true, 2)],
    };
  },
  clues(solution, n, rng, o) {
    const max = Math.min(n, Number(o?.maxCage ?? 5));
    const w = [1, 6, 6, 4, 3, 2, 1, 1, 1].slice(0, max);
    return partition(n, rng, () => weighted(rng, w) + 1, (g, c) => !g.some((x) => solution[x] === solution[c]))
      .map((cells) => ({ type: "killer", cells, sum: cells.reduce((a, x) => a + solution[x]!, 0) }));
  },
  repair(c, cell, solution, n) {
    if (c.cells.length < 2) return null;
    const sum = (cs: number[]) => cs.reduce((a, x) => a + solution[x]!, 0);
    return [[cell], ...splitOff(n, c.cells, cell)].map((cells) => ({ type: "killer", cells, sum: sum(cells) }));
  },
  cells: (c) => c.cells,
  render(c, ctx) {
    ctx.layer.over.append(ctx.svg("path", { d: insetOutline(ctx.n, ctx.S, c.cells, ctx.S * 0.07), class: "sdk-cage" }));
    if (c.sum !== undefined) cornerLabel(ctx, anchorCell(c.cells), String(c.sum), "sdk-cage-sum");
  },
};

export type KeenOp = "+" | "-" | "*" | "/" | "";

export interface KeenSpec extends ConstraintSpec { cells: number[]; op: KeenOp; target: number }

const OP_GLYPH: Record<KeenOp, string> = { "+": "+", "-": "−", "*": "×", "/": "÷", "": "" };

function keenAccept(op: KeenOp, target: number) {
  return (v: readonly number[]): boolean => {
    switch (op) {
      case "+": return v.reduce((a, b) => a + b, 0) === target;
      case "*": return v.reduce((a, b) => a * b, 1) === target;
      case "-": return v.length === 2 && Math.abs(v[0]! - v[1]!) === target;
      case "/": return v.length === 2 && Math.max(v[0]!, v[1]!) === target * Math.min(v[0]!, v[1]!);
      case "": return v.length === 1 && v[0] === target;
    }
  };
}

export const keen: ConstraintType<KeenSpec> = {
  type: "keen",
  label: "arithmetic cage",
  rule: "the digits in each cage combine with its operation to make its number (− and ÷ cages have two cells)",
  kind: "clue",
  validate(c, n) {
    const e = validCells(c.cells, n, n * n);
    if (e) return e;
    if (!["+", "-", "*", "/", ""].includes(c.op)) return `unknown operation "${c.op}"`;
    if ((c.op === "-" || c.op === "/") && c.cells.length !== 2) return "− and ÷ cages need exactly two cells";
    if (c.op === "" && c.cells.length !== 1) return "cages without an operation have one cell";
    return Number.isInteger(c.target) && c.target >= 0 ? null : "target must be a whole number";
  },
  compile(c, n) {
    const label = `the ${c.target}${OP_GLYPH[c.op]} cage`;
    const accept = keenAccept(c.op, c.target);
    const feasible = c.op === "+" ? (v: readonly number[], m: readonly number[]) => sumFeasible(c.target, v, m)
      : c.op === "*" ? (v: readonly number[]) => c.target % v.reduce((a, b) => (b ? a * b : a), 1) === 0
        : undefined;
    return { rules: [predicateRule(n, c.cells, { label, accept, feasible, difficulty: 2 })] };
  },
  clues(solution, n, rng, o) {
    const max = Math.max(1, Math.min(6, Number(o?.maxCage ?? 4)));
    const ops = (o?.ops as string[] | undefined) ?? ["+", "-", "*", "/"];
    const w = [1, 7, 5, 3, 1, 1].slice(0, max);
    return partition(n, rng, () => weighted(rng, w) + 1).map((cells) => keenClue(cells, solution, rng, ops));
  },
  repair(c, cell, solution, n) {
    if (c.cells.length < 2) return null;
    return [[cell], ...splitOff(n, c.cells, cell)].map((cells) => keenClue(cells, solution, null, [c.op]));
  },
  cells: (c) => c.cells,
  render(c, ctx) {
    ctx.layer.over.append(ctx.svg("path", { d: insetOutline(ctx.n, ctx.S, c.cells, ctx.S * 0.04), class: "sdk-keen" }));
    cornerLabel(ctx, anchorCell(c.cells), `${c.target}${OP_GLYPH[c.op]}`, "sdk-keen-label");
  },
};

function keenClue(cells: number[], solution: readonly number[], rng: Rng | null, ops: readonly string[]): KeenSpec {
  const v = cells.map((c) => solution[c]!);
  if (cells.length === 1) return { type: "keen", cells, op: "", target: v[0]! };
  const options: KeenSpec[] = [];
  const allowed = (op: string) => ops.includes(op);
  if (cells.length === 2) {
    const [a, b] = [Math.max(v[0]!, v[1]!), Math.min(v[0]!, v[1]!)];
    if (allowed("/") && a % b === 0) options.push({ type: "keen", cells, op: "/", target: a / b }, { type: "keen", cells, op: "/", target: a / b });
    if (allowed("-")) options.push({ type: "keen", cells, op: "-", target: a - b });
  }
  if (allowed("*")) options.push({ type: "keen", cells, op: "*", target: v.reduce((a, b) => a * b, 1) });
  if (allowed("+") || !options.length) options.push({ type: "keen", cells, op: "+", target: v.reduce((a, b) => a + b, 0) });
  return rng ? rng.pick(options) : options[0]!;
}

export interface LittleKillerSpec extends ConstraintSpec { r: number; c: number; dr: number; dc: number; sum: number }

const lkCells = (s: LittleKillerSpec, n: number) => ray(n, s.r, s.c, s.dr, s.dc);

function sideMargins(r: number, c: number, n: number): Margins {
  return { top: r < 0 ? 1 : 0, bottom: r >= n ? 1 : 0, left: c < 0 ? 1 : 0, right: c >= n ? 1 : 0 };
}

export const littleKiller: ConstraintType<LittleKillerSpec> = {
  type: "littlekiller",
  label: "little killer",
  rule: "an outside clue gives the sum of the digits along its arrow's diagonal (digits may repeat)",
  kind: "clue",
  removable: true,
  validate(s, n) {
    if (Math.abs(s.dr) !== 1 || Math.abs(s.dc) !== 1) return "direction must be diagonal";
    const outside = s.r < 0 || s.c < 0 || s.r >= n || s.c >= n;
    if (!outside) return "clue must sit outside the grid";
    return lkCells(s, n).length ? null : "diagonal misses the grid";
  },
  compile(s, n) {
    const cells = lkCells(s, n);
    return { rules: [linearRule(n, cells, cells.map(() => 1), s.sum, `the little killer ${s.sum}`, 2.5)] };
  },
  clues(solution, n, rng, o) {
    const out: LittleKillerSpec[] = [];
    const add = (r: number, c: number, dr: number, dc: number) => {
      const cells = ray(n, r, c, dr, dc);
      if (cells.length >= 2) out.push({ type: "littlekiller", r, c, dr, dc, sum: cells.reduce((a, x) => a + solution[x]!, 0) });
    };
    for (let i = 0; i < n; i++) {
      add(-1, i, 1, 1); add(-1, i, 1, -1);
      add(n, i, -1, 1); add(n, i, -1, -1);
      add(i, -1, 1, 1); add(i, -1, -1, 1);
      add(i, n, 1, -1); add(i, n, -1, -1);
    }
    return rng.shuffle(out).slice(0, Math.max(2, Math.round(n * 2 * Number(o?.density ?? 0.7))));
  },
  cells: lkCells,
  margin: (s, n) => sideMargins(s.r, s.c, n),
  render(s, ctx) {
    const [x, y] = ctx.at(s.r, s.c);
    const S = ctx.S;
    const ax = x + s.dc * S * 0.3, ay = y + s.dr * S * 0.3;
    const bx = x + s.dc * S * 0.46, by = y + s.dr * S * 0.46;
    const head = S * 0.08;
    ctx.layer.outside.append(
      ctx.svg("text", { x: x - s.dc * S * 0.06, y: y - s.dr * S * 0.06, class: "sdk-outside sdk-lk" }, String(s.sum)),
      ctx.svg("path", {
        d: `M${ax} ${ay}L${bx} ${by}M${bx - s.dc * head} ${by}L${bx} ${by}L${bx} ${by - s.dr * head}`,
        class: "sdk-lk-arrow",
      }));
  },
};

export function outsideRender(ctx: RenderCtx, r: number, c: number, text: string, cls: string): void {
  const [x, y] = ctx.at(r, c);
  ctx.layer.outside.append(ctx.svg("text", { x, y, class: `sdk-outside ${cls}` }, text));
}

export { sideMargins };
