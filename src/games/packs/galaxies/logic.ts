import type { Rng } from "../../core/rng";
import { cellName as boardCell } from "../../core/names";
import { defineSchema, type Values } from "../../core/schema";
import type { Format, GenerateContext, Hint, PuzzleDef } from "../../core/types";
import { LEVEL_NAMES, analyze, generatePuzzle, geometry, type Dot, type GalaxiesPuzzle, type Level } from "./solver";

export type { GalaxiesPuzzle } from "./solver";

export const params = defineSchema({
  width: { type: "int", label: "width", default: 7, min: 3, max: 15 },
  height: { type: "int", label: "height", default: 7, min: 3, max: 15 },
  difficulty: {
    type: "enum", label: "difficulty", default: "medium",
    options: [
      { value: "easy", label: "easy", description: "mirror images, and tiles only one dot can reach" },
      { value: "medium", label: "medium", description: "also tiles a galaxy can't connect without" },
      { value: "hard", label: "hard", description: "also trying each dot for a tile and seeing all but one fail" },
    ],
  },
});

export interface GalaxiesState {
  /** Dot per tile, -1 where not yet assigned. Tiles under a dot are always its own. */
  owner: number[];
}

/** Painting with -1 only clears tiles, so it alone is a retraction. */
export type GalaxiesAction = { type: "paint"; tiles: number[]; dot: number };

export interface GalaxiesInteraction {
  cursor: number;
  /** Dot the keyboard paints with, or -1. */
  brush: number;
}

export function reduce(p: GalaxiesPuzzle, s: GalaxiesState, a: GalaxiesAction): GalaxiesState {
  if (a.type !== "paint" || !(a.dot >= -1 && a.dot < p.dots.length)) return s;
  const g = geometry(p);
  let owner: number[] | null = null;
  for (const t of a.tiles) {
    if (t < 0 || t >= g.n || g.coreOf[t] !== -1 || s.owner[t] === a.dot) continue;
    owner ??= s.owner.slice();
    owner[t] = a.dot;
  }
  return owner ? { owner } : s;
}

/** Tiles of each galaxy that break its shape: no mirror image in it, or cut off from its dot. */
export function brokenTiles(p: GalaxiesPuzzle, owner: readonly number[]): { asymmetric: number[]; detached: number[] } {
  const g = geometry(p);
  const asymmetric: number[] = [], detached: number[] = [];
  for (let d = 0; d < g.nd; d++) {
    const seen = new Uint8Array(g.n);
    const stack = g.core[d]!.slice();
    for (const t of stack) seen[t] = 1;
    while (stack.length) {
      const t = stack.pop()!;
      for (const u of g.nbrs[t]!) if (!seen[u] && owner[u] === d) { seen[u] = 1; stack.push(u); }
    }
    for (let t = 0; t < g.n; t++) {
      if (owner[t] !== d) continue;
      const m = g.mirror[d * g.n + t]!;
      if (m < 0 || (owner[m] !== -1 && owner[m] !== d)) asymmetric.push(t);
      if (!seen[t]) detached.push(t);
    }
  }
  return { asymmetric, detached };
}

export function isSolved(p: GalaxiesPuzzle, s: GalaxiesState): boolean {
  if (s.owner.some((d) => d < 0)) return false;
  const g = geometry(p);
  for (let t = 0; t < g.n; t++) {
    const d = s.owner[t]!;
    if (s.owner[g.mirror[d * g.n + t]!] !== d) return false;
  }
  const b = brokenTiles(p, s.owner);
  return !b.asymmetric.length && !b.detached.length;
}

// --- formats ---

const SGT_RE = /^(\d+)(?:x(\d+))?[^:]*:([a-zA-Y]*)$/;

function checkDots(w: number, h: number, dots: Dot[]): GalaxiesPuzzle {
  const p: GalaxiesPuzzle = { w, h, dots };
  const seen = new Set<number>();
  geometry(p).core.forEach((tiles) => {
    for (const t of tiles) {
      if (seen.has(t)) throw new Error("two dots are too close together");
      seen.add(t);
    }
  });
  return p;
}

/**
 * Simon Tatham's Galaxies game id: `WxH[dX]:desc`. Dots go on the (2w-1)×(2h-1) inner points of the
 * doubled grid (tile centers, edges and corners), row by row: a–y / A–Y is a dot (white / black)
 * after 0–24 empty points, z is 25 empty points.
 */
export const sgtFormat: Format<GalaxiesPuzzle> = {
  id: "sgt",
  label: "game id (WxH:…)",
  detect: (t) => SGT_RE.test(t.trim()),
  parse(t) {
    const m = SGT_RE.exec(t.trim());
    if (!m) throw new Error("expected WxH:desc, e.g. 7x7:gbjcc…");
    const w = Number(m[1]), h = m[2] ? Number(m[2]) : w;
    if (!(w >= 1 && h >= 1 && w <= 40 && h <= 40)) throw new Error("size must be between 1×1 and 40×40");
    const iw = 2 * w - 1, total = iw * (2 * h - 1);
    const dots: Dot[] = [];
    let i = 0;
    for (const ch of m[3]!) {
      if (ch === "z") { i += 25; continue; }
      const black = ch >= "A" && ch <= "Y";
      i += ch.charCodeAt(0) - (black ? 65 : 97);
      if (i >= total) throw new Error("too much data to fit on the board");
      dots.push({ x: (i % iw) + 1, y: Math.floor(i / iw) + 1, black });
      i++;
    }
    if (!dots.length) throw new Error("the puzzle needs at least one dot");
    return checkDots(w, h, dots);
  },
  serialize(p) {
    const iw = 2 * p.w - 1;
    const at = new Map(p.dots.map((d) => [(d.y - 1) * iw + (d.x - 1), d]));
    let out = "", run = 0;
    for (let i = 0; i < iw * (2 * p.h - 1); i++) {
      const d = at.get(i);
      if (!d) { run++; continue; }
      while (run > 24) { out += "z"; run -= 25; }
      out += String.fromCharCode((d.black ? 65 : 97) + run);
      run = 0;
    }
    return `${p.w}x${p.h}:${out}`;
  },
};

// --- names, conflicts, hints ---

export const cellName = (p: { w: number }, c: number) => boardCell(c % p.w, Math.floor(c / p.w));

export function cellList(p: { w: number }, cells: readonly number[]): string {
  const names = cells.slice(0, 3).map((c) => cellName(p, c));
  const rest = cells.length - names.length;
  if (rest > 0) return `${names.join(", ")} and ${rest} more`;
  return names.length > 1 ? `${names.slice(0, -1).join(", ")} and ${names[names.length - 1]}` : names[0] ?? "";
}

/** "the dot in C3", "the dot between C3 and D3", "the dot where C3 and D4 meet". */
export function dotName(p: GalaxiesPuzzle, d: number): string {
  const core = geometry(p).core[d]!;
  if (core.length === 1) return `the dot in ${cellName(p, core[0]!)}`;
  if (core.length === 2) return `the dot between ${cellName(p, core[0]!)} and ${cellName(p, core[1]!)}`;
  return `the dot where ${cellName(p, core[0]!)} and ${cellName(p, core[3]!)} meet`;
}

/** Focus payload understood by the galaxies view. */
export interface GalaxiesFocus {
  /** Tiles the hint changes. */
  tiles: number[];
  /** Tiles explaining why. */
  because: number[];
  /** Dots it is about. */
  dots: number[];
}

/** Rule breaks visible without knowing the answer. */
export interface Conflicts {
  /** Tiles whose mirror image through their dot is off the board or someone else's. */
  asymmetric: number[];
  /** Tiles not joined to their dot through their own galaxy. */
  detached: number[];
}

export const findConflicts = (p: GalaxiesPuzzle, s: GalaxiesState): Conflicts => brokenTiles(p, s.owner);

/** Tiles given to the wrong dot, as a hint that clears them. */
export function wrongMarksHint(p: GalaxiesPuzzle, s: GalaxiesState): Hint<GalaxiesAction> | null {
  const a = analyze(p);
  if (a.count !== 1 || !a.solution) return null;
  const wrong = s.owner.flatMap((d, t) => (d >= 0 && a.solution![t] !== d ? [t] : []));
  if (!wrong.length) return null;
  return {
    message: `${cellList(p, wrong)} ${wrong.length === 1 ? "is" : "are"} in the wrong galaxy`,
    focus: { tiles: wrong, because: [], dots: [] } satisfies GalaxiesFocus,
    actions: [{ type: "paint", tiles: wrong, dot: -1 }],
  };
}

export function hint(p: GalaxiesPuzzle, s: GalaxiesState): Hint<GalaxiesAction> | null {
  const c = findConflicts(p, s);
  if (c.asymmetric.length) return { message: `${cellList(p, c.asymmetric)} ${c.asymmetric.length === 1 ? "has" : "have"} no mirror image in ${c.asymmetric.length === 1 ? "its" : "their"} galaxy`, focus: { tiles: [], because: c.asymmetric, dots: [] } satisfies GalaxiesFocus };
  if (c.detached.length) return { message: `${cellList(p, c.detached)} ${c.detached.length === 1 ? "isn't" : "aren't"} joined to ${c.detached.length === 1 ? "its" : "their"} dot`, focus: { tiles: [], because: c.detached, dots: [] } satisfies GalaxiesFocus };
  const a = analyze(p);
  if (a.count === 0) return { message: "this puzzle has no solution" };
  if (a.count === 2) return { message: "this puzzle has more than one solution, so it can need a guess" };
  return { message: "none of the techniques you have hints on applies here" };
}

function rate(p: GalaxiesPuzzle): { label: string; score: number } {
  const a = analyze(p);
  if (a.count === 0) return { label: "no solution", score: -1 };
  if (a.count === 2) return { label: "multiple solutions", score: 10 };
  if (a.level === null) return { label: "needs guessing", score: 3 };
  return { label: LEVEL_NAMES[a.level], score: a.level };
}

function generate(v: Values<typeof params>, rng: Rng, ctx: GenerateContext): Promise<GalaxiesPuzzle> {
  return generatePuzzle(v.width, v.height, LEVEL_NAMES.indexOf(v.difficulty as (typeof LEVEL_NAMES)[number]) as Level, rng, ctx);
}

export const galaxies: PuzzleDef<GalaxiesPuzzle, GalaxiesState, GalaxiesAction, GalaxiesInteraction, typeof params> = {
  id: "galaxies",
  name: "galaxies",
  aliases: ["tentai show", "spiral galaxies", "tentaisho"],
  tags: ["logic", "grid", "regions", "symmetry", "nikoli"],
  description: "split the board into galaxies: each one has exactly one dot, at its center, and looks the same turned upside down around that dot.",
  generatorVersion: 1,
  params,
  presets: [
    { label: "5×5 easy", params: { width: 5, height: 5, difficulty: "easy" } },
    { label: "7×7 medium", params: { width: 7, height: 7, difficulty: "medium" } },
    { label: "7×7 hard", params: { width: 7, height: 7, difficulty: "hard" } },
    { label: "10×10 medium", params: { width: 10, height: 10, difficulty: "medium" } },
    { label: "10×10 hard", params: { width: 10, height: 10, difficulty: "hard" } },
    { label: "15×15 hard", params: { width: 15, height: 15, difficulty: "hard" } },
  ],
  generate,
  formats: [sgtFormat],
  init: (p) => ({ owner: Array.from(geometry(p).coreOf) }),
  initInteraction: (p) => ({ cursor: geometry(p).core[0]?.[0] ?? 0, brush: -1 }),
  reduce,
  isRetraction: (a) => a.dot < 0,
  rules: () => [
    "split the board into galaxies along the grid lines. every tile belongs to exactly one galaxy.",
    "each galaxy contains exactly one dot, at its center: turned half a turn around the dot, the galaxy lands exactly on itself.",
    "a galaxy is one connected piece. a dot on an edge or a corner belongs to all the tiles it touches.",
  ],
  isSolved,
  solve(p) {
    const a = analyze(p);
    return a.solution ? { owner: a.solution.slice() } : null;
  },
  hint,
  rate,
  describe: (p) => `${p.w}×${p.h}`,
};
