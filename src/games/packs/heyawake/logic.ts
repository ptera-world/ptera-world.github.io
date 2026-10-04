import type { Rng } from "../../core/rng";
import { defineSchema, type Values } from "../../core/schema";
import type { Format, GenerateContext, Hint, PuzzleDef } from "../../core/types";
import {
  analyzeModel, decidedBy, decides, solveLevel, trialRule,
  type Analysis, type Constraint, type Doms, type Model, type Rule,
} from "../../lib/grid-kit/csp";
import { cutVertices, neighbours, pieces } from "../../lib/grid-kit/grid";
import { cellList, type Focus } from "../../lib/grid-kit/names";
import { decodeBorders, decodeNumber16, encodeBorders, encodeNumber16 } from "../../lib/pzpr";
import { rivalSolution } from "../../lib/shade-kit/repair";
import {
  ANY, B, BLACK, DOT, W, describeShade, initShade, readShade, reduceShade, solvedShade, wrongShadeHint,
  type ShadeAction, type ShadeInteraction, type ShadeState,
} from "../../lib/shade-kit/state";

export interface HeyawakePuzzle {
  w: number;
  h: number;
  /** Room id per cell, row-major; ids are numbered in row-major order of each room's first cell. */
  rooms: number[];
  /** Per room: how many of its cells are shaded, or -1 when it has no number. */
  clues: number[];
}

export const LEVEL_NAMES = ["easy", "normal", "hard"] as const;
export type Level = 0 | 1 | 2;

export const params = defineSchema({
  width: { type: "int", label: "width", default: 8, min: 4, max: 16 },
  height: { type: "int", label: "height", default: 8, min: 4, max: 16 },
  difficulty: {
    type: "enum", label: "difficulty", default: "normal",
    options: [
      { value: "easy", label: "easy", description: "room counts, neighbors of shaded cells, and runs that would cross two walls" },
      { value: "normal", label: "normal", description: "also shaded cells that would cut the unshaded area in two" },
      { value: "hard", label: "hard", description: "also trying a cell both ways" },
    ],
  },
});

// --- geometry ---

export interface Geometry {
  w: number;
  h: number;
  n: number;
  nbrs: number[][];
  /** Cells of each room, row-major. */
  cells: number[][];
  /** Per room, the cell its number is written in (its first cell). */
  clueCell: number[];
  /** Straight runs from the last cell before one wall to the first cell past the next: each needs a shaded cell. */
  spans: number[][];
}

const geoCache = new WeakMap<HeyawakePuzzle, Geometry>();

export function geometry(p: HeyawakePuzzle): Geometry {
  const hit = geoCache.get(p);
  if (hit) return hit;
  const { w, h } = p;
  const n = w * h;
  const count = p.rooms.reduce((a, r) => Math.max(a, r + 1), 0);
  const cells: number[][] = Array.from({ length: count }, () => []);
  for (let c = 0; c < n; c++) cells[p.rooms[c]!]!.push(c);
  const spans: number[][] = [];
  const scan = (line: number[]) => {
    const walls: number[] = [];
    for (let i = 0; i + 1 < line.length; i++) if (p.rooms[line[i]!] !== p.rooms[line[i + 1]!]) walls.push(i);
    for (let j = 0; j + 1 < walls.length; j++) spans.push(line.slice(walls[j]!, walls[j + 1]! + 2));
  };
  for (let y = 0; y < h; y++) scan(Array.from({ length: w }, (_, x) => y * w + x));
  for (let x = 0; x < w; x++) scan(Array.from({ length: h }, (_, y) => y * w + x));
  const g = { w, h, n, nbrs: neighbours(w, h), cells, clueCell: cells.map((cs) => cs[0]!), spans };
  geoCache.set(p, g);
  return g;
}

// --- model ---

const modelCache = new WeakMap<HeyawakePuzzle, Model>();

export function model(p: HeyawakePuzzle): Model {
  const hit = modelCache.get(p);
  if (hit) return hit;
  const g = geometry(p);
  const constraints: Constraint[] = [];
  for (let c = 0; c < g.n; c++) {
    const around = g.nbrs[c]!;
    constraints.push({
      vars: [c, ...around],
      run(k, emit) {
        if (k[c] !== B) return true;
        if (around.some((d) => k[d] === B)) return false;
        const open = around.filter((d) => k[d] === ANY);
        if (open.length) emit({ kind: "black-neighbour", level: 0, vars: open, keep: W, because: [c] });
        return true;
      },
    });
  }
  g.cells.forEach((cells, r) => {
    const want = p.clues[r]!;
    if (want < 0) return;
    constraints.push({
      vars: cells,
      run(k, emit) {
        const black = cells.filter((c) => k[c] === B), open = cells.filter((c) => k[c] === ANY);
        if (black.length > want || black.length + open.length < want) return false;
        if (!open.length) return true;
        const because = [g.clueCell[r]!];
        if (black.length === want) emit({ kind: "room-full", level: 0, vars: open, keep: W, because, related: black, data: { room: r } });
        else if (black.length + open.length === want) emit({ kind: "room-fill", level: 0, vars: open, keep: B, because, data: { room: r } });
        return true;
      },
    });
  });
  for (const span of g.spans) {
    constraints.push({
      vars: span,
      run(k, emit) {
        if (span.some((c) => k[c] === B)) return true;
        const open = span.filter((c) => k[c] === ANY);
        if (!open.length) return false;
        if (open.length === 1) emit({ kind: "span", level: 0, vars: open, keep: B, because: span.filter((c) => c !== open[0]) });
        return true;
      },
    });
  }
  const split: Rule = {
    level: 1,
    kinds: ["split"],
    run(k, emit) {
      if (pieces(g.nbrs, (c) => k[c] !== B).count > 1) return false;
      const cut = cutVertices(g.nbrs, (c) => k[c] !== B);
      for (let c = 0; c < g.n; c++) if (cut[c] && k[c] === ANY && emit({ kind: "split", level: 1, vars: [c], keep: W, because: [] })) return true;
      return true;
    },
  };
  const m: Model = {
    n: g.n,
    constraints,
    rules: [split],
    countLevel: 1,
    complete: (k) => pieces(g.nbrs, (c) => k[c] !== B).count <= 1,
  };
  m.rules.push(trialRule(m, 2, 1));
  modelCache.set(p, m);
  return m;
}

/** True if the given shading (everything else unshaded) obeys every rule. */
function isDone(p: HeyawakePuzzle, g: Geometry, black: (c: number) => boolean): boolean {
  for (let c = 0; c < g.n; c++) if (black(c) && g.nbrs[c]!.some(black)) return false;
  if (pieces(g.nbrs, (c) => !black(c)).count !== 1) return false;
  if (!g.cells.every((cells, r) => p.clues[r]! < 0 || cells.filter(black).length === p.clues[r])) return false;
  return g.spans.every((span) => span.some(black));
}

export const initialDoms = (p: HeyawakePuzzle): Doms => new Int32Array(p.w * p.h).fill(ANY);

const analyses = new WeakMap<HeyawakePuzzle, Analysis>();

/** Unique-solution analysis, memoized per puzzle. `solution` holds WHITE / SHADED per cell. */
export function analyze(p: HeyawakePuzzle): Analysis {
  let a = analyses.get(p);
  if (!a) analyses.set(p, a = analyzeModel(model(p), initialDoms(p), 2));
  return a;
}

const never = () => false;
export const readMarks = (p: HeyawakePuzzle, s: ShadeState): Doms => readShade(initialDoms(p), analyze(p), s, never);

// --- rules check ---

export interface HeyawakeConflicts extends Record<string, number[]> {
  /** Shaded cells side by side. */
  touching: number[];
  /** Number cells of rooms with too many shaded cells, or too few cells left to shade. */
  rooms: number[];
  /** Dotted runs that cross two walls. */
  runs: number[];
  /** Cells walled off from the rest by shaded cells. */
  cut: number[];
}

export function findConflicts(p: HeyawakePuzzle, marks: readonly number[]): HeyawakeConflicts {
  const g = geometry(p);
  const black = (c: number) => marks[c] === BLACK;
  const touching = Array.from({ length: g.n }, (_, c) => c).filter((c) => black(c) && g.nbrs[c]!.some(black));
  const rooms = g.cells.flatMap((cells, r) => {
    const want = p.clues[r]!;
    if (want < 0) return [];
    const shaded = cells.filter(black).length, possible = cells.filter((c) => marks[c] !== DOT).length;
    return shaded > want || possible < want ? [g.clueCell[r]!] : [];
  });
  const runs = [...new Set(g.spans.filter((span) => span.every((c) => marks[c] === DOT)).flat())];
  const pc = pieces(g.nbrs, (c) => !black(c));
  const cut: number[] = [];
  if (pc.count > 1) {
    const size = Array.from({ length: pc.count }, () => 0);
    for (let c = 0; c < g.n; c++) if (pc.id[c]! >= 0) size[pc.id[c]!]!++;
    const main = size.indexOf(Math.max(...size));
    for (let c = 0; c < g.n; c++) if (pc.id[c]! >= 0 && pc.id[c] !== main) cut.push(c);
  }
  return { touching, rooms, runs, cut };
}

export const isSolved = (p: HeyawakePuzzle, s: ShadeState): boolean => isDone(p, geometry(p), (c) => s.marks[c] === BLACK);

// --- formats ---

function checked(w: number, h: number, rooms: number[], clues: number[]): HeyawakePuzzle {
  const p: HeyawakePuzzle = { w, h, rooms, clues };
  const g = geometry(p);
  g.cells.forEach((cells, r) => {
    const v = clues[r]!;
    if (v > cells.length) throw new Error(`a room of ${cells.length} cells can't have ${v} shaded`);
  });
  return p;
}

const URL_RE = /(?:^|[?/])heyawake\/(\d+)\/(\d+)\/([0-9a-v][0-9a-z.+-]*)\/?$/;

/** puz.link / pzv.jp URLs: `…?heyawake/W/H/<borders><room numbers>`; unknown numbers (`.`) read as none. */
export const pzprFormat: Format<HeyawakePuzzle> = {
  id: "pzpr",
  label: "puzz.link URL",
  detect: (t) => URL_RE.test(t.trim()),
  parse(t) {
    const m = URL_RE.exec(t.trim());
    if (!m) throw new Error("expected a puzz.link heyawake URL, e.g. https://puzz.link/p?heyawake/6/6/…");
    const w = Number(m[1]), h = Number(m[2]);
    if (!(w >= 2 && h >= 2 && w <= 40 && h <= 40)) throw new Error("size must be between 2×2 and 40×40");
    const { regions, rest } = decodeBorders(w, h, m[3]!);
    const count = regions.reduce((a, r) => Math.max(a, r + 1), 0);
    const { values } = decodeNumber16(rest, count);
    return checked(w, h, regions, values.map((v) => (v < 0 ? -1 : v)));
  },
  serialize: (p) => `https://puzz.link/p?heyawake/${p.w}/${p.h}/${encodeBorders(p.w, p.h, p.rooms)}${encodeNumber16(p.clues)}`,
};

const SYM = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";

/**
 * Two blocks separated by a blank line: one character per cell, equal characters one room; then
 * the same grid with each room's number (or `.`) at any of its cells, tokens separated by spaces.
 */
export const textFormat: Format<HeyawakePuzzle> = {
  id: "text",
  label: "room letters, then numbers",
  detect: (t) => /^\S+(\n\S+)*\n\s*\n[\d. ]+(\n[\d. ]+)*$/.test(t.trim()),
  parse(t) {
    const [top, bottom] = t.trim().split(/\r?\n\s*\r?\n/);
    if (!top || !bottom) throw new Error("expected the room letters, a blank line, then the numbers");
    const rows = top.split(/\r?\n/).map((r) => [...r.trim()]);
    const w = rows[0]!.length, h = rows.length;
    if (rows.some((r) => r.length !== w)) throw new Error("every row needs the same number of cells");
    const nums = bottom.split(/\r?\n/).map((r) => r.trim().split(/\s+/));
    if (nums.length !== h || nums.some((r) => r.length !== w)) throw new Error("the numbers must be laid out like the rooms");
    const ids = new Map<string, number>();
    const letters = rows.flat();
    const pc = pieces(neighbours(w, h).map((ns, c) => ns.filter((d) => letters[d] === letters[c])), () => true);
    for (let c = 0; c < w * h; c++) {
      const key = letters[c]!;
      if (!ids.has(key)) ids.set(key, pc.id[c]!);
      else if (ids.get(key) !== pc.id[c]) throw new Error("each room must be one connected piece");
    }
    const rooms = Array.from(pc.id);
    const clues = Array.from({ length: pc.count }, () => -1);
    nums.flat().forEach((tok, c) => {
      if (tok === ".") return;
      const v = Number(tok);
      if (!Number.isInteger(v) || v < 0) throw new Error(`"${tok}" isn't a number`);
      const r = rooms[c]!;
      if (clues[r]! >= 0 && clues[r] !== v) throw new Error("a room has two different numbers");
      clues[r] = v;
    });
    return checked(w, h, rooms, clues);
  },
  serialize(p) {
    const g = geometry(p);
    const rows: string[] = [], nums: string[] = [];
    for (let y = 0; y < p.h; y++) {
      const cs = Array.from({ length: p.w }, (_, x) => y * p.w + x);
      rows.push(cs.map((c) => SYM[p.rooms[c]! % SYM.length]).join(""));
      nums.push(cs.map((c) => (g.clueCell[p.rooms[c]!] === c && p.clues[p.rooms[c]!]! >= 0 ? String(p.clues[p.rooms[c]!]) : ".")).join(" "));
    }
    return `${rows.join("\n")}\n\n${nums.join("\n")}`;
  },
};

// --- hints ---

export const wrongMarksHint = (p: HeyawakePuzzle, s: ShadeState): Hint<ShadeAction> | null => wrongShadeHint(p, analyze(p), s);

export function hint(p: HeyawakePuzzle, s: ShadeState): Hint<ShadeAction> | null {
  const c = findConflicts(p, s.marks);
  if (c.touching.length) return { message: `the shaded cells on ${cellList(p, c.touching)} touch`, focus: { cells: c.touching, because: [] } satisfies Focus };
  if (c.rooms.length) return { message: `the room numbered on ${cellList(p, c.rooms)} can't get the right count any more`, focus: { cells: [], because: c.rooms } satisfies Focus };
  if (c.runs.length) return { message: `the unshaded run through ${cellList(p, c.runs)} crosses two walls`, focus: { cells: c.runs, because: [] } satisfies Focus };
  if (c.cut.length) return { message: `${cellList(p, c.cut)} ${c.cut.length === 1 ? "is" : "are"} cut off from the other unshaded cells`, focus: { cells: c.cut, because: [] } satisfies Focus };
  const a = analyze(p);
  if (a.count === 0) return { message: "this puzzle has no solution" };
  if (a.count === 2) return { message: "this puzzle has more than one solution, so it can need a guess" };
  return { message: "none of the techniques you have hints on applies here" };
}

function rate(p: HeyawakePuzzle): { label: string; score: number } {
  const a = analyze(p);
  if (a.count === 0) return { label: "no solution", score: -1 };
  if (a.count === 2) return { label: "multiple solutions", score: 10 };
  if (a.level === null) return { label: "needs guessing", score: 3 };
  return { label: LEVEL_NAMES[a.level]!, score: a.level };
}

// --- generation ---

/**
 * Rectangular rooms by repeated cuts. A rectangle larger than `most` cells is always cut, a
 * smaller one at random; cuts leave both parts at least two cells wide where the side allows.
 */
export function cutRooms(w: number, h: number, rng: Rng, most: number): number[] {
  const rooms = Array.from({ length: w * h }, () => 0);
  const todo: [number, number, number, number][] = [[0, 0, w, h]];
  let next = 0;
  while (todo.length) {
    const [x, y, rw, rh] = todo.pop()!;
    const area = rw * rh;
    const wide = rw >= 4, tall = rh >= 4;
    const stop = area <= most && (rng.bool(0.5) || (!wide && !tall));
    if (stop || (rw === 1 && rh === 1)) {
      for (let j = y; j < y + rh; j++) for (let i = x; i < x + rw; i++) rooms[j * w + i] = next;
      next++;
      continue;
    }
    const cutAt = (len: number) => (len >= 4 ? 2 + rng.int(len - 3) : 1 + rng.int(len - 1));
    const across = wide && tall ? rng.int(rw + rh) < rw : wide || (!tall && rw >= rh && rw > 1);
    if (across) {
      const cut = cutAt(rw);
      todo.push([x, y, cut, rh], [x + cut, y, rw - cut, rh]);
    } else {
      const cut = cutAt(rh);
      todo.push([x, y, rw, cut], [x, y + cut, rw, rh - cut]);
    }
  }
  return relabel(w, h, rooms);
}

/**
 * A valid shading: every run that crosses two walls gets a shaded cell, then more cells are
 * tried at random; a cell is shaded only when it touches no shaded cell and leaves the unshaded
 * cells joined. Null when some run can't be broken.
 */
function plantShading(g: Geometry, rng: Rng, extra: number): Uint8Array | null {
  const black = new Uint8Array(g.n);
  const can = (c: number) => {
    if (black[c] || g.nbrs[c]!.some((d) => black[d])) return false;
    black[c] = 1;
    const ok = pieces(g.nbrs, (d) => !black[d]).count === 1;
    black[c] = 0;
    return ok;
  };
  for (const span of rng.shuffle(g.spans.slice())) {
    if (span.some((c) => black[c])) continue;
    const options = span.filter(can);
    if (!options.length) return null;
    black[rng.pick(options)] = 1;
  }
  for (const c of rng.shuffle(Array.from({ length: g.n }, (_, i) => i)).slice(0, Math.floor(g.n * extra))) if (can(c)) black[c] = 1;
  return black;
}

const decidedAt = (p: HeyawakePuzzle, level: number): boolean => decides(model(p), initialDoms(p), level);

/** `rooms` relabelled in row-major order of each room's first cell. */
const relabel = (w: number, h: number, rooms: readonly number[]): number[] =>
  Array.from(pieces(neighbours(w, h).map((ns, c) => ns.filter((d) => rooms[d] === rooms[c])), () => true).id);

/** Every way to cut one rectangular room in two with a straight line, never leaving a single cell, as the new room layouts. */
function roomCuts(w: number, h: number, rooms: readonly number[], g: Geometry): number[][] {
  const out: number[][] = [];
  g.cells.forEach((cells) => {
    const xs = cells.map((c) => c % w), ys = cells.map((c) => Math.floor(c / w));
    const x0 = Math.min(...xs), x1 = Math.max(...xs), y0 = Math.min(...ys), y1 = Math.max(...ys);
    const split = (side: (c: number) => boolean) => {
      const moved = cells.filter(side).length;
      if (moved < 2 || cells.length - moved < 2) return;
      const next = rooms.slice();
      const fresh = rooms.length;
      for (const c of cells) if (side(c)) next[c] = fresh;
      out.push(relabel(w, h, next));
    };
    for (let x = x0 + 1; x <= x1; x++) split((c) => c % w >= x);
    for (let y = y0 + 1; y <= y1; y++) split((c) => Math.floor(c / w) >= y);
  });
  return out;
}

/**
 * Cuts rooms until logic at `level` finishes the puzzle with every room numbered from `black`.
 * Only cuts that `black` still satisfies (each new run across two walls keeps a shaded cell) are
 * used. While a rival solution exists, a cut that gives the rival a different count in one of the
 * new rooms is taken, which rules that rival out; otherwise the cut after which cheap logic
 * decides the most. Null when no cut is left.
 */
async function refineRooms(w: number, h: number, rooms: number[], black: Uint8Array, level: Level, rng: Rng, ctx: GenerateContext): Promise<number[] | null> {
  const intended = Array.from(black);
  const numbered = (rs: readonly number[]): HeyawakePuzzle => {
    const g = geometry({ w, h, rooms: rs.slice(), clues: [] });
    return { w, h, rooms: rs.slice(), clues: g.cells.map((cells) => cells.filter((c) => black[c]).length) };
  };
  for (;;) {
    await ctx.yield();
    const p = numbered(rooms);
    if (decidedAt(p, level)) return rooms;
    const g = geometry(p);
    const cuts = roomCuts(w, h, rooms, g).filter((rs) => geometry({ w, h, rooms: rs, clues: [] }).spans.every((span) => span.some((c) => black[c])));
    if (!cuts.length) return null;
    const rival = rivalSolution(model(p), initialDoms(p), intended);
    if (rival) {
      const killers = cuts.filter((rs) => {
        const cg = geometry({ w, h, rooms: rs, clues: [] });
        return cg.cells.some((cells) => cells.filter((c) => rival[c] === 1).length !== cells.filter((c) => black[c]).length);
      });
      if (killers.length) {
        rooms = rng.pick(killers);
        continue;
      }
    }
    let best: number[] | null = null, top = -2;
    for (const rs of rng.shuffle(cuts).slice(0, 12)) {
      const q = numbered(rs);
      const got = decidedBy(model(q), initialDoms(q), Math.min(level, 1));
      if (got > top) { top = got; best = rs; }
    }
    rooms = best!;
  }
}

const EXACT_ATTEMPTS = 60;
const MAX_ATTEMPTS = 400;

/**
 * Deterministic in (params, rng): rectangular rooms and a planted shading, rooms cut until logic
 * at the level finishes the puzzle with every room numbered, then numbers removed while logic
 * (first one level easier, then the level itself) still finishes it. Needs exactly the level
 * when one turns up within EXACT_ATTEMPTS layouts, else the hardest found.
 */
export async function generatePuzzle(w: number, h: number, level: Level, rng: Rng, ctx: GenerateContext): Promise<HeyawakePuzzle> {
  let best: { p: HeyawakePuzzle; level: number } | null = null;
  for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
    if (best && attempt >= EXACT_ATTEMPTS) break;
    await ctx.yield();
    const r = rng.fork(`attempt ${attempt}`);
    const start = cutRooms(w, h, r, 9);
    const black = plantShading(geometry({ w, h, rooms: start, clues: [] }), r, 0.35);
    if (!black) continue;
    const rooms = await refineRooms(w, h, start, black, level, r, ctx);
    if (!rooms) continue;
    const g = geometry({ w, h, rooms, clues: [] });
    const clues = g.cells.map((cells) => cells.filter((c) => black[c]).length);
    for (const pass of level > 0 ? [level - 1, level] : [level]) {
      for (const room of r.shuffle(clues.map((_, i) => i))) {
        if (clues[room]! < 0) continue;
        await ctx.yield();
        const keep = clues[room]!;
        clues[room] = -1;
        if (!decidedAt({ w, h, rooms, clues: clues.slice() }, pass)) clues[room] = keep;
      }
    }
    const p: HeyawakePuzzle = { w, h, rooms, clues };
    const got = solveLevel(model(p), initialDoms(p), level)!;
    if (got === level) return p;
    if (!best || got > best.level) best = { p, level: got };
  }
  if (best) return best.p;
  throw new Error("couldn't make a puzzle with these settings; try a different size");
}

export const heyawake: PuzzleDef<HeyawakePuzzle, ShadeState, ShadeAction, ShadeInteraction, typeof params> = {
  id: "heyawake",
  name: "heyawake",
  tags: ["logic", "grid", "regions", "shading", "numbers", "nikoli"],
  description: "shade cells so that each numbered room holds that many shaded cells. shaded cells never touch side by side, the unshaded cells stay in one piece, and no straight run of unshaded cells crosses two room walls.",
  generatorVersion: 1,
  params,
  presets: [
    { label: "7×7 easy", params: { width: 7, height: 7, difficulty: "easy" } },
    { label: "8×8 normal", params: { width: 8, height: 8, difficulty: "normal" } },
    { label: "10×10 normal", params: { width: 10, height: 10, difficulty: "normal" } },
    { label: "10×10 hard", params: { width: 10, height: 10, difficulty: "hard" } },
  ],
  generate: (v: Values<typeof params>, rng, ctx) => generatePuzzle(v.width, v.height, LEVEL_NAMES.indexOf(v.difficulty as (typeof LEVEL_NAMES)[number]) as Level, rng, ctx),
  formats: [pzprFormat, textFormat],
  init: (p) => initShade(p.w * p.h),
  initInteraction: () => ({ cursor: 0 }),
  reduce: (p, s, a) => reduceShade(p.w * p.h, never, s, a),
  isRetraction: (a) => a.value === 0,
  rules: () => [
    "shade some cells. a number in a room is how many of that room's cells are shaded; rooms without a number can hold any count.",
    "shaded cells may not touch side by side (corners are fine).",
    "all the unshaded cells must form one connected area.",
    "a straight line of unshaded cells may cross at most one room wall: it can span two rooms, never three.",
    "a dot is your own note that a cell stays unshaded. it doesn't count for anything.",
  ],
  isSolved,
  solve(p) {
    const a = analyze(p);
    return a.solution ? solvedShade(a.solution, never) : null;
  },
  hint,
  rate,
  describeAction: (p, a, before, after) => describeShade(p, a, before, after),
  describe: (p) => `${p.w}×${p.h}`,
};
