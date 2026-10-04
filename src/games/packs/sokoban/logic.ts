import { cellName as boardCell } from "../../core/names";
import type { Rng } from "../../core/rng";
import { defineSchema, type Values } from "../../core/schema";
import type { Format, GenerateContext, Hint, PuzzleDef } from "../../core/types";
import { DIR_NAMES, FLOOR, WALL, allHome, generatePuzzle, isFloor, solvePushes, stepFrom, stuckBoxes, walkPath, walkable, type Push, type SokoPuzzle } from "./solver";

export type { SokoPuzzle } from "./solver";

export const params = defineSchema({
  width: { type: "int", label: "room width", default: 7, min: 4, max: 10 },
  height: { type: "int", label: "room height", default: 7, min: 4, max: 10 },
  boxes: { type: "int", label: "boxes", default: 3, min: 1, max: 5 },
});

export interface SokoState {
  player: number;
  /** Ascending. */
  boxes: number[];
  moves: number;
  pushes: number;
}

/**
 * step: one step (pushing a box if one is in the way and can move). walk: to a cell by the
 * shortest way, pushing nothing. push: walk behind a box and push it once.
 */
export type SokoAction =
  | { type: "step"; dir: number }
  | { type: "walk"; to: number }
  | { type: "push"; box: number; dir: number };

export interface SokoInteraction {
  /** Box picked to push somewhere with the next click, or -1. */
  picked: number;
}

/** Hint focus: boxes and cells to point at, and pushes to show. */
export interface SokoFocus {
  boxes?: number[];
  cells?: number[];
  pushes?: Push[];
}

export const cellName = (p: { w: number }, c: number): string => boardCell(c % p.w, Math.floor(c / p.w));

function moveTo(s: SokoState, player: number, steps: number, from?: number, to?: number): SokoState {
  const boxes = from === undefined ? s.boxes : s.boxes.map((b) => (b === from ? to! : b)).sort((a, b) => a - b);
  return { player, boxes, moves: s.moves + steps, pushes: s.pushes + (from === undefined ? 0 : 1) };
}

export function reduce(p: SokoPuzzle, s: SokoState, a: SokoAction): SokoState {
  const set = new Set(s.boxes);
  if (a.type === "step") {
    const n = stepFrom(p, s.player, a.dir);
    if (!isFloor(p, n)) return s;
    if (!set.has(n)) return moveTo(s, n, 1);
    const beyond = stepFrom(p, n, a.dir);
    if (!isFloor(p, beyond) || set.has(beyond)) return s;
    return moveTo(s, n, 1, n, beyond);
  }
  if (a.type === "walk") {
    if (!isFloor(p, a.to) || set.has(a.to) || a.to === s.player) return s;
    const path = walkPath(p, set, s.player, a.to);
    return path ? moveTo(s, a.to, path.length) : s;
  }
  if (a.type === "push") {
    if (!set.has(a.box)) return s;
    const stand = stepFrom(p, a.box, (a.dir + 2) % 4), to = stepFrom(p, a.box, a.dir);
    if (!isFloor(p, stand) || set.has(stand) || !isFloor(p, to) || set.has(to)) return s;
    const path = walkPath(p, set, s.player, stand);
    if (!path) return s;
    return moveTo(s, a.box, path.length + 1, a.box, to);
  }
  return s;
}

// --- formats ---

const FLOOR_CHARS = new Set([" ", "-", "_"]);

/** Read XSB rows: # wall, space/-/_ floor, @ player, + player on goal, $ box, * box on goal, . goal. */
function fromRows(rows: string[]): SokoPuzzle {
  while (rows.length && !rows[0]!.trim()) rows.shift();
  while (rows.length && !rows[rows.length - 1]!.trim()) rows.pop();
  const h = rows.length, w = Math.max(0, ...rows.map((r) => r.length));
  if (w < 3 || h < 3 || w > 60 || h > 60) throw new Error("size must be between 3×3 and 60×60");
  const cells: number[] = [], goals: number[] = [], boxes: number[] = [];
  let player = -1;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const ch = rows[y]![x] ?? " ";
      const c = y * w + x;
      if (ch === "#") { cells.push(WALL); continue; }
      if (!FLOOR_CHARS.has(ch) && !"@+$*.".includes(ch)) throw new Error(`"${ch}" isn't a sokoban symbol (# $ . * @ + and space)`);
      cells.push(FLOOR);
      if (ch === "." || ch === "*" || ch === "+") goals.push(c);
      if (ch === "$" || ch === "*") boxes.push(c);
      if (ch === "@" || ch === "+") {
        if (player >= 0) throw new Error("there's more than one player");
        player = c;
      }
    }
  }
  if (player < 0) throw new Error("there's no player (@ or +)");
  if (!boxes.length) throw new Error("there are no boxes ($ or *)");
  if (goals.length < boxes.length) throw new Error(`there are ${boxes.length} boxes but only ${goals.length} goals`);
  // floor the player can never reach (boxes ignored) is outside the level: it becomes wall
  const p: SokoPuzzle = { w, h, cells, goals, boxes, player };
  const inside = walkable(p, new Set(), player);
  for (let c = 0; c < cells.length; c++) {
    if (cells[c] !== FLOOR || inside[c]) continue;
    if (goals.includes(c) || boxes.includes(c)) {
      if (!(goals.includes(c) && boxes.includes(c))) throw new Error(`${cellName(p, c)} is out of the player's reach`);
    }
    cells[c] = WALL;
  }
  return {
    ...p,
    goals: goals.filter((c) => inside[c]),
    boxes: boxes.filter((c) => inside[c]),
  };
}

function toRows(p: SokoPuzzle, s?: { player: number; boxes: readonly number[] }): string[] {
  const goals = new Set(p.goals), boxes = new Set(s?.boxes ?? p.boxes);
  const player = s?.player ?? p.player;
  const inside = walkable(p, new Set(), player);
  const rows: string[] = [];
  for (let y = 0; y < p.h; y++) {
    let row = "";
    for (let x = 0; x < p.w; x++) {
      const c = y * p.w + x;
      const near = [0, 1, 2, 3].some((d) => { const o = stepFrom(p, c, d); return o >= 0 && inside[o]; }) || [[-1, -1], [1, -1], [-1, 1], [1, 1]].some(([dx, dy]) => {
        const xx = x + dx!, yy = y + dy!;
        return xx >= 0 && yy >= 0 && xx < p.w && yy < p.h && inside[yy * p.w + xx];
      });
      if (p.cells[c] === WALL) row += near ? "#" : " ";
      else if (c === player) row += goals.has(c) ? "+" : "@";
      else if (boxes.has(c)) row += goals.has(c) ? "*" : "$";
      else row += goals.has(c) ? "." : " ";
    }
    rows.push(row.replace(/\s+$/, ""));
  }
  return rows;
}

/** XSB: the level's rows as they look, one per line. */
export const xsbFormat: Format<SokoPuzzle> = {
  id: "xsb",
  label: "xsb (# walls, $ boxes, . goals, @ player)",
  detect: (t) => t.includes("\n") && /^[#@+$*. \-_\r\n]+$/.test(t.replace(/^\s*\n/, "")) && /[@+]/.test(t),
  parse: (text) => fromRows(text.replace(/\t/g, " ").split(/\r?\n/)),
  serialize: (p) => toRows(p).join("\n"),
};

/** Run-length XSB on one line: rows joined by |, a number before a symbol repeats it, - for floor. */
export const rleFormat: Format<SokoPuzzle> = {
  id: "rle",
  label: "run-length xsb (rows split by |)",
  detect: (t) => !t.trim().includes("\n") && t.includes("|") && /^[#@+$*.\-_|\d]+$/.test(t.trim()),
  parse(text) {
    const rows = text.trim().split("|").map((row) => row.replace(/(\d+)([^\d])/g, (_, n: string, ch: string) => ch.repeat(Number(n))).replace(/[-_]/g, " "));
    return fromRows(rows);
  },
  serialize: (p) => toRows(p).map((row) => row.replace(/ /g, "-").replace(/(.)\1+/g, (run, ch: string) => `${run.length}${ch}`)).join("|"),
};

// --- hints ---

export const pushText = (p: SokoPuzzle, m: Push): string => `push the box at ${cellName(p, m.box)} ${DIR_NAMES[m.dir]}`;

const solveCache = new WeakMap<SokoState, ReturnType<typeof solvePushes>>();

/** Fewest pushes from this state (cached per state). */
export function solveFrom(p: SokoPuzzle, s: SokoState): ReturnType<typeof solvePushes> {
  let r = solveCache.get(s);
  if (!r) solveCache.set(s, (r = solvePushes(p, { boxes: s.boxes, player: s.player })));
  return r;
}

/** Boxes that can never reach a goal, or a position the search proves unsolvable, as a hint to undo. */
export function stuckHint(p: SokoPuzzle, s: SokoState): Hint<SokoAction> | null {
  if (allHome(p, s.boxes)) return null;
  const stuck = stuckBoxes(p, s.boxes);
  if (stuck.length) {
    const one = stuck.length === 1;
    return { message: `the ${one ? "box" : "boxes"} at ${stuck.map((c) => cellName(p, c)).join(", ")} can't be moved onto a goal any more (${one ? "it's" : "they're"} against walls or other boxes). undo to get back.`, focus: { boxes: stuck } satisfies SokoFocus };
  }
  const r = solveFrom(p, s);
  if (!r.pushes && !r.gaveUp) return { message: "the boxes can't all reach goals from here any more. undo to get back." };
  return null;
}

export function hint(p: SokoPuzzle, s: SokoState): Hint<SokoAction> | null {
  const r = solveFrom(p, s);
  if (r.gaveUp) return { message: "this level is too big for the hint search" };
  if (!r.pushes) return { message: "the boxes can't all reach goals from here any more. undo to get back." };
  return { message: "none of the techniques you have hints on applies here" };
}

function describeAction(p: SokoPuzzle, a: SokoAction, before: SokoState, after: SokoState): string {
  if (a.type === "walk") return `walk to ${cellName(p, a.to)}`;
  if (a.type === "push") return pushText(p, a).replace("push the box at", "push");
  if (after.pushes > before.pushes) return `push ${cellName(p, after.player)} ${DIR_NAMES[a.dir]}`;
  return DIR_NAMES[a.dir] ?? "";
}

function generate(v: Values<typeof params>, rng: Rng, ctx: GenerateContext): Promise<SokoPuzzle> {
  return generatePuzzle({ w: v.width, h: v.height, boxes: v.boxes }, rng, ctx);
}

const rateCache = new WeakMap<SokoPuzzle, { label: string; score: number }>();

export const sokoban: PuzzleDef<SokoPuzzle, SokoState, SokoAction, SokoInteraction, typeof params> = {
  id: "sokoban",
  name: "sokoban",
  aliases: ["warehouse keeper", "box pushing", "boxxle"],
  tags: ["classic", "moves"],
  description: "push every box onto a goal. boxes can only be pushed, one at a time, never pulled.",
  generatorVersion: 1,
  params,
  presets: [
    { label: "6×6 · 2 boxes", params: { width: 6, height: 6, boxes: 2 } },
    { label: "7×7 · 3 boxes", params: { width: 7, height: 7, boxes: 3 } },
    { label: "8×8 · 3 boxes", params: { width: 8, height: 8, boxes: 3 } },
    { label: "8×8 · 4 boxes", params: { width: 8, height: 8, boxes: 4 } },
    { label: "10×8 · 4 boxes", params: { width: 10, height: 8, boxes: 4 } },
  ],
  generate,
  formats: [rleFormat, xsbFormat],
  init: (p) => ({ player: p.player, boxes: p.boxes.slice().sort((a, b) => a - b), moves: 0, pushes: 0 }),
  initInteraction: () => ({ picked: -1 }),
  reduce,
  isSolved: (p, s) => allHome(p, s.boxes),
  solve(p) {
    let s = sokoban.init(p);
    const r = solveFrom(p, s);
    if (!r.pushes) return null;
    for (const m of r.pushes) s = reduce(p, s, { type: "push", ...m });
    return s;
  },
  hint,
  rate(p) {
    let r = rateCache.get(p);
    if (!r) {
      const sol = solveFrom(p, sokoban.init(p));
      r = sol.pushes ? { label: `${sol.pushes.length} pushes`, score: sol.pushes.length } : { label: sol.gaveUp ? "too big to rate" : "no solution", score: -1 };
      rateCache.set(p, r);
    }
    return r;
  },
  describeAction,
  rules: () => [
    "walk the warehouse keeper around the room; walking into a box pushes it one cell, if the cell beyond is free.",
    "boxes can't be pulled, and only one box moves at a time.",
    "get every box onto a goal.",
  ],
  describe: (p) => `${p.boxes.length} ${p.boxes.length === 1 ? "box" : "boxes"}`,
};
