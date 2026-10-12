import type { Rng } from "../../core/rng";
import { defineSchema, type Values } from "../../core/schema";
import type { Format, GenerateContext, PuzzleDef } from "../../core/types";
import { BANDS, LEVEL_NAMES, canSlide, distance, exitAt, generatePuzzle, isGoal, plan, startPos, type Car, type RushPuzzle } from "./solver";

export type { RushPuzzle } from "./solver";

export const params = defineSchema({
  width: { type: "int", label: "width", default: 6, min: 4, max: 8 },
  height: { type: "int", label: "height", default: 6, min: 4, max: 8 },
  difficulty: {
    type: "enum", label: "difficulty", default: "medium",
    options: LEVEL_NAMES.map((value, i) => ({ value, label: value, description: `${BANDS[i]![0]} to ${BANDS[i]![1]} moves at best` })),
  },
});

export interface RushState {
  /** Per car, its column (horizontal cars) or row (vertical cars). */
  pos: number[];
  moves: number;
}

/** Slide a car along its length to `to` (a column or row), through free cells only. Any distance is one move. */
export type RushAction = { type: "slide"; car: number; to: number };

export interface RushInteraction {
  /** Car picked for the keyboard, or -1. */
  selected: number;
}

/** Hint focus: cars to point at, the move to make, and cells that matter. */
export interface RushFocus {
  cars?: number[];
  slide?: { car: number; to: number };
  cells?: number[];
}

export const carName = (i: number): string => String.fromCharCode(65 + i);

export function reduce(p: RushPuzzle, s: RushState, a: RushAction): RushState {
  if (a.type !== "slide" || !canSlide(p, s.pos, a)) return s;
  const pos = s.pos.slice();
  pos[a.car] = a.to;
  return { pos, moves: s.moves + 1 };
}

// --- formats ---

/** Read a grid of letters: A the red car, other letters the other cars, x a wall, o or . empty. */
function fromRows(rows: string[]): RushPuzzle {
  const h = rows.length, w = rows[0]?.length ?? 0;
  if (rows.some((r) => r.length !== w)) throw new Error("rows have different lengths");
  if (w < 3 || h < 2 || w > 12 || h > 12) throw new Error("size must be between 3×2 and 12×12");
  const cells = new Map<string, number[]>();
  const walls: number[] = [];
  rows.join("").split("").forEach((ch, c) => {
    if (ch === "o" || ch === "." || ch === "_") return;
    if (ch === "x") { walls.push(c); return; }
    if (!/[A-Z]/.test(ch)) throw new Error(`"${ch}" isn't a car letter (A-Z), x for a wall, or o for empty`);
    cells.set(ch, [...(cells.get(ch) ?? []), c]);
  });
  if (!cells.has("A")) throw new Error("there's no red car (A)");
  const letters = [...cells.keys()].sort();
  const cars: Car[] = letters.map((ch) => {
    const list = cells.get(ch)!;
    const xs = list.map((c) => c % w), ys = list.map((c) => Math.floor(c / w));
    const horizontal = ys.every((y) => y === ys[0]);
    const vertical = xs.every((x) => x === xs[0]);
    const len = list.length;
    const span = horizontal ? Math.max(...xs) - Math.min(...xs) + 1 : Math.max(...ys) - Math.min(...ys) + 1;
    if (len < 2 || (!horizontal && !vertical) || span !== len) throw new Error(`car ${ch} must be a straight line of at least 2 cells`);
    return { x: Math.min(...xs), y: Math.min(...ys), len, horizontal };
  });
  if (!cars[0]!.horizontal) throw new Error("the red car (A) must lie left to right: it leaves by the right edge");
  return { w, h, cars, walls };
}

function toRows(p: RushPuzzle): string[] {
  const g = Array.from({ length: p.w * p.h }, () => "o");
  for (const c of p.walls) g[c] = "x";
  p.cars.forEach((car, i) => {
    for (let k = 0; k < car.len; k++) g[car.horizontal ? car.y * p.w + car.x + k : (car.y + k) * p.w + car.x] = carName(i);
  });
  return Array.from({ length: p.h }, (_, y) => g.slice(y * p.w, y * p.w + p.w).join(""));
}

const FOGLEMAN_RE = /(?:^|\s)([A-Zox.]{36})(?:\s|$)/;

/**
 * Michael Fogleman's Rush Hour database line: a 6×6 board as 36 characters, row by row: `o` (or
 * `.`) empty, `x` a wall, `A` the red car, `B`…`Z` the others. A database line's move count and
 * cluster size around it are ignored.
 */
export const foglemanFormat: Format<RushPuzzle> = {
  id: "fogleman",
  label: "6×6 board string (Fogleman's database)",
  detect: (t) => FOGLEMAN_RE.test(t.trim()),
  parse(text) {
    const m = FOGLEMAN_RE.exec(text.trim());
    if (!m) throw new Error("expected 36 characters: o empty, x wall, A the red car, B-Z the others");
    return fromRows(Array.from({ length: 6 }, (_, y) => m[1]!.slice(y * 6, y * 6 + 6)));
  },
  serialize(p) {
    if (p.w !== 6 || p.h !== 6) throw new Error("only 6×6 boards fit this format");
    return toRows(p).join("");
  },
};

/** The same letters as rows, one per line, any size. */
export const gridFormat: Format<RushPuzzle> = {
  id: "grid",
  label: "grid (rows of letters, o empty, x wall)",
  detect: (t) => t.trim().includes("\n") && /^[A-Zox._\s]+$/.test(t.trim()),
  parse: (text) => fromRows(text.trim().split(/\r?\n/).map((r) => r.trim()).filter(Boolean)),
  serialize: (p) => toRows(p).join("\n"),
};

function describeAction(p: RushPuzzle, a: RushAction, before: RushState): string {
  if (a.type !== "slide") return "";
  const car = p.cars[a.car]!;
  const d = a.to - before.pos[a.car]!;
  if (a.car === 0 && a.to === exitAt(p)) return "A out";
  const dir = car.horizontal ? (d > 0 ? "right" : "left") : (d > 0 ? "down" : "up");
  return `${carName(a.car)} ${dir}${Math.abs(d) > 1 ? ` ${Math.abs(d)}` : ""}`;
}

function generate(v: Values<typeof params>, rng: Rng, ctx: GenerateContext): Promise<RushPuzzle> {
  return generatePuzzle({ w: v.width, h: v.height, difficulty: LEVEL_NAMES.indexOf(v.difficulty as (typeof LEVEL_NAMES)[number]) }, rng, ctx);
}

export const rushhour: PuzzleDef<RushPuzzle, RushState, RushAction, RushInteraction, typeof params> = {
  id: "rushhour",
  name: "rush hour",
  aliases: ["traffic jam", "unblock me", "parking lot", "sliding blocks"],
  tags: ["classic", "sliding", "moves"],
  description: "slide the cars and trucks out of the way so the red car can drive out of the lot.",
  generatorVersion: 1,
  params,
  presets: [
    { label: "6×6 easy", params: { width: 6, height: 6, difficulty: "easy" } },
    { label: "6×6 medium", params: { width: 6, height: 6, difficulty: "medium" } },
    { label: "6×6 hard", params: { width: 6, height: 6, difficulty: "hard" } },
    { label: "5×5 medium", params: { width: 5, height: 5, difficulty: "medium" } },
    { label: "7×7 hard", params: { width: 7, height: 7, difficulty: "hard" } },
  ],
  generate,
  formats: [gridFormat, foglemanFormat],
  init: (p) => ({ pos: startPos(p), moves: 0 }),
  initInteraction: () => ({ selected: 0 }),
  reduce,
  isSolved: (p, s) => isGoal(p, s.pos),
  solve(p, s) {
    const route = plan(p, s.pos);
    return route ? { moves: route.map((m) => ({ type: "slide" as const, ...m })) } : null;
  },
  rate(p) {
    const d = distance(p, startPos(p));
    return d === null ? { label: "no way out", score: -1 } : { label: `${d} moves`, score: d };
  },
  describeAction,
  rules: () => [
    "cars and trucks only drive forwards and backwards along their length, never sideways, and can't pass through each other.",
    "a car can slide any distance in one move, as long as nothing is in the way.",
    "get the red car (A) to the exit on the right edge of its row.",
  ],
  describe: (p) => `${p.w}×${p.h}`,
};
