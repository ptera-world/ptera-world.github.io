import { cellName } from "../../core/names";
import type { Rng } from "../../core/rng";
import { defineSchema, type Values } from "../../core/schema";
import type { Format, GenerateContext, PuzzleDef, Rating } from "../../core/types";
import { clearFrom } from "./solver";

export const MAX_COLOURS = 9;

export const params = defineSchema({
  width: { type: "int", label: "width", default: 5, min: 2, max: 20 },
  height: { type: "int", label: "height", default: 5, min: 2, max: 15 },
  colours: { type: "int", label: "colours", default: 3, min: 3, max: MAX_COLOURS },
  scoring: {
    type: "enum", label: "scoring", default: "2",
    options: [
      { value: "2", label: "(n−2)²", description: "removing two tiles scores nothing" },
      { value: "1", label: "(n−1)²", description: "every removal scores" },
    ],
  },
  soluble: { type: "bool", label: "always clearable", default: true, description: "built backwards from an empty board, so the whole grid can be cleared" },
});

export interface SamegamePuzzle {
  w: number;
  h: number;
  colours: number;
  /** Subtracted from a group's size before squaring for its score. */
  scoreSub: number;
  /** Row-major colours 1…colours; 0 = empty. Row 0 is the top. */
  grid: number[];
  /** Cells to click, in order, that clear the board (generated boards). */
  solution?: number[];
}

export interface SamegameState {
  grid: number[];
  score: number;
  moves: number;
}

/** Remove the group containing `cell` (two or more joined tiles of one colour). */
export type SamegameAction = { type: "remove"; cell: number };

export interface SamegameFocus {
  cells?: number[];
}

export interface SamegameInteraction {
  cursor: number;
}

export const cellAt = (p: { w: number }, c: number) => cellName(c % p.w, Math.floor(c / p.w));

/** The joined same-colour group containing `cell` (empty for an empty cell). */
export function group(w: number, h: number, grid: readonly number[], cell: number): number[] {
  const col = grid[cell];
  if (!col) return [];
  const seen = new Set([cell]);
  const stack = [cell];
  while (stack.length) {
    const p = stack.pop()!;
    const x = p % w, y = Math.floor(p / w);
    for (const q of [x > 0 ? p - 1 : -1, x < w - 1 ? p + 1 : -1, y > 0 ? p - w : -1, y < h - 1 ? p + w : -1]) {
      if (q >= 0 && !seen.has(q) && grid[q] === col) { seen.add(q); stack.push(q); }
    }
  }
  return [...seen].sort((a, b) => a - b);
}

/** One representative cell (the lowest index) per removable group. */
export function groups(w: number, h: number, grid: readonly number[]): number[][] {
  const seen = new Uint8Array(grid.length);
  const out: number[][] = [];
  for (let c = 0; c < grid.length; c++) {
    if (seen[c] || !grid[c]) continue;
    const g = group(w, h, grid, c);
    for (const q of g) seen[q] = 1;
    if (g.length >= 2) out.push(g);
  }
  return out;
}

/** Remove cells, let tiles fall, then close up empty columns to the left. */
export function collapse(w: number, h: number, grid: readonly number[], cells: readonly number[]): number[] {
  const g = grid.slice();
  for (const c of cells) g[c] = 0;
  const cols: number[][] = [];
  for (let x = 0; x < w; x++) {
    const col: number[] = [];
    for (let y = h - 1; y >= 0; y--) if (g[y * w + x]) col.push(g[y * w + x]!);
    if (col.length) cols.push(col);
  }
  const out = Array.from({ length: w * h }, () => 0);
  cols.forEach((col, x) => col.forEach((v, k) => { out[(h - 1 - k) * w + x] = v; }));
  return out;
}

export const points = (scoreSub: number, n: number): number => (n > scoreSub ? (n - scoreSub) ** 2 : 0);

export const isEmpty = (grid: readonly number[]): boolean => grid.every((c) => c === 0);
export const isStuck = (p: Pick<SamegamePuzzle, "w" | "h">, grid: readonly number[]): boolean => !isEmpty(grid) && groups(p.w, p.h, grid).length === 0;

// --- generation: built backwards from an empty board by inserting groups whose removal undoes them ---

type Columns = number[][];

function toGrid(w: number, h: number, cols: Columns): number[] {
  const out = Array.from({ length: w * h }, () => 0);
  cols.forEach((col, x) => col.forEach((v, k) => { out[(h - 1 - k) * w + x] = v; }));
  return out;
}

interface Insertion {
  /** New columns are spliced in at these indices (ascending), each starting empty. */
  newCols: number[];
  /** (column, height) slots the group goes into, in the layout after new columns are added. */
  slots: [number, number][];
}

function insertionsFor(w: number, h: number, cols: Columns, size: number): Insertion[] {
  const out: Insertion[] = [];
  const n = cols.length;
  const len = (i: number) => cols[i]!.length;
  if (size === 2) {
    for (let i = 0; i < n; i++) for (let r = 0; r <= len(i) && len(i) + 2 <= h; r++) out.push({ newCols: [], slots: [[i, r], [i, r + 1]] });
    if (n < w && h >= 2) for (let i = 0; i <= n; i++) out.push({ newCols: [i], slots: [[i, 0], [i, 1]] });
    for (let i = 0; i + 1 < n; i++) {
      const top = Math.min(len(i), len(i + 1));
      if (len(i) < h && len(i + 1) < h) for (let r = 0; r <= top; r++) out.push({ newCols: [], slots: [[i, r], [i + 1, r]] });
    }
    if (n + 2 <= w) for (let i = 0; i <= n; i++) out.push({ newCols: [i, i + 1], slots: [[i, 0], [i + 1, 0]] });
    if (n < w) {
      for (let i = 0; i <= n; i++) {
        if (i > 0 && len(i - 1) < h) out.push({ newCols: [i], slots: [[i - 1, 0], [i, 0]] });
        if (i < n && len(i) < h) out.push({ newCols: [i], slots: [[i, 0], [i + 1, 0]] });
      }
    }
  } else if (h >= 3) out.push({ newCols: [0], slots: [[0, 0], [0, 1], [0, 2]] });
  else out.push({ newCols: [0, 1, 2], slots: [[0, 0], [1, 0], [2, 0]] });
  return out;
}

function apply(cols: Columns, ins: Insertion, colour: number): Columns {
  const next = cols.map((c) => c.slice());
  for (const i of ins.newCols) next.splice(i, 0, []);
  const byCol = new Map<number, number[]>();
  for (const [c, r] of ins.slots) byCol.set(c, [...(byCol.get(c) ?? []), r]);
  for (const [c, rs] of byCol) for (const r of rs.sort((a, b) => a - b)) next[c]!.splice(r, 0, colour);
  return next;
}

/** Colours touching the inserted slots from outside (in the layout after insertion). */
function neighbourColours(cols: Columns, slots: [number, number][]): Set<number> {
  const inside = new Set(slots.map(([c, r]) => `${c},${r}`));
  const out = new Set<number>();
  for (const [c, r] of slots) {
    for (const [dc, dr] of [[1, 0], [-1, 0], [0, 1], [0, -1]] as const) {
      const cc = c + dc, rr = r + dr;
      if (inside.has(`${cc},${rr}`)) continue;
      const v = cols[cc]?.[rr];
      if (v) out.add(v);
    }
  }
  return out;
}

/** Free space can still be filled: odd leftovers need a neighbour to share a sideways pair with. */
function fillable(w: number, h: number, cols: Columns): boolean {
  const free = Array.from({ length: w }, (_, i) => h - (cols[i]?.length ?? 0));
  for (let i = 0; i < w; i++) {
    if (free[i]! % 2 === 0) continue;
    if (free[i]! === 0) continue;
    if (i + 1 < w && free[i + 1]! > 0) { free[i + 1]!--; continue; }
    return false;
  }
  return true;
}

async function soluble(w: number, h: number, colours: number, rng: Rng, ctx: GenerateContext): Promise<{ grid: number[]; solution: number[] }> {
  const area = w * h;
  for (let attempt = 0; ; attempt++) {
    let cols: Columns = [];
    const steps: { cols: Columns; slots: [number, number][] }[] = [];
    let filled = 0;
    let ok = true;
    while (filled < area) {
      const size = filled === 0 && area % 2 === 1 ? 3 : 2;
      const options = rng.shuffle(insertionsFor(w, h, cols, size));
      let done = false;
      for (const ins of options) {
        const trial = apply(cols, ins, -1);
        if (!fillable(w, h, trial)) continue;
        const banned = neighbourColours(trial, ins.slots);
        const allowed = Array.from({ length: colours }, (_, c) => c + 1).filter((c) => !banned.has(c));
        if (!allowed.length) continue;
        cols = apply(cols, ins, rng.pick(allowed));
        steps.push({ cols, slots: ins.slots });
        filled += size;
        done = true;
        break;
      }
      if (!done) { ok = false; break; }
    }
    if (attempt % 4 === 3) await ctx.yield();
    if (!ok) continue;
    const solution = steps.reverse().map(({ slots }) => {
      const [c, r] = slots[0]!;
      return (h - 1 - r) * w + c;
    });
    return { grid: toGrid(w, h, cols), solution };
  }
}

async function generate(v: Values<typeof params>, rng: Rng, ctx: GenerateContext): Promise<SamegamePuzzle> {
  const w = v.width, h = v.height, colours = v.colours, scoreSub = Number(v.scoring);
  if (!v.soluble) {
    let grid: number[];
    do grid = Array.from({ length: w * h }, () => 1 + rng.int(colours));
    while (isStuck({ w, h }, grid));
    return { w, h, colours, scoreSub, grid };
  }
  const { grid, solution } = await soluble(w, h, colours, rng, ctx);
  return { w, h, colours, scoreSub, grid, solution };
}

// --- formats ---

function checked(w: number, h: number, colours: number, scoreSub: number, grid: number[]): SamegamePuzzle {
  if (!(w >= 1 && h >= 1 && w <= 60 && h <= 60 && w * h >= 2)) throw new Error("size out of range");
  if (grid.length !== w * h) throw new Error(`expected ${w * h} cells, got ${grid.length}`);
  if (grid.some((c) => !Number.isInteger(c) || c < 0 || c > colours)) throw new Error(`colours run from 1 to ${colours} (0 for an empty cell)`);
  if (colours > MAX_COLOURS) throw new Error(`at most ${MAX_COLOURS} colours`);
  return { w, h, colours, scoreSub, grid: collapse(w, h, grid, []) };
}

const SGT_RE = /^(\d+)(?:x(\d+))?(?:c(\d+))?(?:s(\d+))?(r?):([\d,\s]+)$/;

/** Simon Tatham's Same Game id: `WxHcNsN[r]:` then every cell's colour (1…N, 0 empty), comma-separated. */
export const sgtFormat: Format<SamegamePuzzle> = {
  id: "sgt",
  label: "sgt game id (WxHcNsN:n,n,…)",
  detect: (t) => SGT_RE.test(t.trim()),
  parse(text) {
    const m = SGT_RE.exec(text.trim());
    if (!m) throw new Error("expected WxHcNsN:n,n,…, e.g. 5x5c3s2:1,2,…");
    const w = Number(m[1]), h = Number(m[2] ?? m[1]);
    const grid = m[6]!.split(",").map((x) => Number(x.trim()));
    const colours = m[3] ? Number(m[3]) : Math.max(3, ...grid);
    return checked(w, h, colours, m[4] ? Number(m[4]) : 2, grid);
  },
  serialize: (p) => `${p.w}x${p.h}c${p.colours}s${p.scoreSub}:${p.grid.join(",")}`,
};

/** One row per line, top first: a digit per cell (`.` or 0 for empty). */
export const gridFormat: Format<SamegamePuzzle> = {
  id: "grid",
  label: "grid (rows of digits)",
  detect: (t) => t.trim().includes("\n") && /^[\d.\s]+$/.test(t.trim()),
  parse(text) {
    const rows = text.trim().split(/\r?\n/).map((r) => r.trim()).filter(Boolean);
    const h = rows.length, w = rows[0]?.length ?? 0;
    if (rows.some((r) => r.length !== w)) throw new Error("rows have different lengths");
    const grid = rows.join("").split("").map((ch) => (ch === "." ? 0 : Number(ch)));
    return checked(w, h, Math.max(3, ...grid), 2, grid);
  },
  serialize(p) {
    const rows: string[] = [];
    for (let y = 0; y < p.h; y++) rows.push(p.grid.slice(y * p.w, y * p.w + p.w).map((c) => (c ? String(c) : ".")).join(""));
    return rows.join("\n");
  },
};

export const COLOUR_NAMES = ["", "red", "blue", "green", "yellow", "purple", "orange", "cyan", "pink", "grey"] as const;

function rate(p: SamegamePuzzle): Rating {
  const n = groups(p.w, p.h, p.grid).length;
  return { label: `${n} ${n === 1 ? "group" : "groups"} to start`, score: p.colours * 100 + n };
}

export const samegame: PuzzleDef<SamegamePuzzle, SamegameState, SamegameAction, SamegameInteraction, typeof params> = {
  id: "samegame",
  name: "same game",
  aliases: ["samegame", "same game", "jawbreaker", "clickomania", "chain shot"],
  tags: ["colours", "moves", "gravity"],
  description: "clear the board by removing groups of joined tiles of one colour. tiles above fall down, and empty columns close up to the left.",
  generatorVersion: 1,
  params,
  presets: [
    { label: "5×5, 3 colours", params: { width: 5, height: 5, colours: 3 } },
    { label: "10×5, 3 colours", params: { width: 10, height: 5, colours: 3 } },
    { label: "15×10, 3 colours", params: { width: 15, height: 10, colours: 3 } },
    { label: "15×10, 4 colours", params: { width: 15, height: 10, colours: 4 } },
    { label: "20×15, 4 colours", params: { width: 20, height: 15, colours: 4 } },
  ],
  generate,
  formats: [sgtFormat, gridFormat],
  init: (p) => ({ grid: p.grid.slice(), score: 0, moves: 0 }),
  initInteraction: (p) => ({ cursor: (p.h - 1) * p.w }),
  reduce(p, s, a) {
    if (a.type !== "remove" || a.cell < 0 || a.cell >= s.grid.length) return s;
    const g = group(p.w, p.h, s.grid, a.cell);
    if (g.length < 2) return s;
    return { grid: collapse(p.w, p.h, s.grid, g), score: s.score + points(p.scoreSub, g.length), moves: s.moves + 1 };
  },
  isSolved: (_p, s) => isEmpty(s.grid),
  isLost: (p, s) => isStuck(p, s.grid),
  hint: (p, s) => (isEmpty(s.grid) || isStuck(p, s.grid) || clearFrom(p, s.grid).path
    ? null
    : { message: "the search for a clearing order ran out of time from here, so there's no suggestion. undoing a move or two may help." }),
  rate,
  rules: (p) => [
    "click a group of two or more joined tiles of the same colour (joined across edges) to remove it.",
    "tiles above fall into the gap; a column that empties closes up to the left.",
    `removing n tiles at once scores (n − ${p.scoreSub})².`,
    "clear the whole board. the game ends when no group of two is left.",
  ],
  describe: (p) => `${p.w}×${p.h}, ${p.colours} colours`,
};
