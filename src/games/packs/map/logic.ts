import type { Rng } from "../../core/rng";
import { cellName as boardCell } from "../../core/names";
import { defineSchema, type Values } from "../../core/schema";
import type { Format, GenerateContext, Hint, PuzzleDef } from "../../core/types";
import { ALL, geometry, type MapPuzzle } from "./grid";
import { LEVEL_NAMES, analyze, generatePuzzle, type Level } from "./solver";

export type { MapPuzzle } from "./grid";

export const params = defineSchema({
  width: { type: "int", label: "width", default: 20, min: 4, max: 40 },
  height: { type: "int", label: "height", default: 15, min: 4, max: 40 },
  regions: { type: "int", label: "regions", default: 30, min: 4, max: 200, description: "at most one per cell" },
  difficulty: {
    type: "enum", label: "difficulty", default: "medium",
    options: [
      { value: "easy", label: "easy", description: "regions with only one color left" },
      { value: "medium", label: "medium", description: "also two neighboring regions sharing the same two colors" },
      { value: "hard", label: "hard", description: "also trying a color and seeing it fail" },
    ],
  },
});

export interface MapState {
  /** Color per region, -1 for none; givens included. */
  colours: number[];
  /** Pencil marks per region: color bits, 0 for none. */
  marks: number[];
}

/** Clearing a color and toggling a pencil mark are the player's own edits, so they count as retractions. */
export type MapAction =
  | { type: "colour"; regions: number[]; colour: number }
  | { type: "marks"; regions: number[]; marks: number }
  | { type: "toggle-mark"; region: number; colour: number };

export interface MapInteraction {
  /** Keyboard cursor cell. */
  cursor: number;
  /** Typed colors go in as pencil marks. */
  pencil: boolean;
}

export const COLOUR_NAMES = ["red", "yellow", "green", "blue"] as const;

const editable = (p: MapPuzzle, r: number) => r >= 0 && r < p.n && p.given[r]! < 0;

export function reduce(p: MapPuzzle, s: MapState, a: MapAction): MapState {
  switch (a.type) {
    case "colour": {
      if (!(a.colour >= -1 && a.colour <= 3)) return s;
      let colours: number[] | null = null, marks: number[] | null = null;
      for (const r of a.regions) {
        if (!editable(p, r) || (s.colours[r] === a.colour && (a.colour < 0 || !s.marks[r]))) continue;
        colours ??= s.colours.slice();
        marks ??= s.marks.slice();
        colours[r] = a.colour;
        if (a.colour >= 0) marks[r] = 0;
      }
      return colours ? { colours, marks: marks! } : s;
    }
    case "marks": {
      let marks: number[] | null = null;
      for (const r of a.regions) {
        if (!editable(p, r) || s.colours[r]! >= 0 || s.marks[r] === (a.marks & ALL)) continue;
        marks ??= s.marks.slice();
        marks[r] = a.marks & ALL;
      }
      return marks ? { ...s, marks } : s;
    }
    case "toggle-mark": {
      if (!editable(p, a.region) || s.colours[a.region]! >= 0 || !(a.colour >= 0 && a.colour <= 3)) return s;
      const marks = s.marks.slice();
      marks[a.region] = marks[a.region]! ^ (1 << a.colour);
      return { ...s, marks };
    }
    default:
      return s;
  }
}

export function isSolved(p: MapPuzzle, s: MapState): boolean {
  const g = geometry(p);
  for (let r = 0; r < p.n; r++) {
    if (s.colours[r]! < 0) return false;
    if (g.adj[r]!.some((o) => s.colours[o] === s.colours[r])) return false;
  }
  return true;
}

// --- formats ---

const SGT_RE = /^(\d+)(?:x(\d+))?(?:n(\d+))?[^:]*:([a-z]*),([0-3a-z]*)$/;

const edgeCount = (w: number, h: number) => w * (h - 1) + (w - 1) * h;

/** Cells on either side of edge i in the original's order: the w*(h-1) horizontal edges row by row, then the vertical ones column by column. */
function edgeCells(w: number, h: number, i: number): [number, number] {
  if (i < w * (h - 1)) {
    const y = Math.floor(i / w), x = i % w;
    return [y * w + x, (y + 1) * w + x];
  }
  const j = i - w * (h - 1);
  const x = Math.floor(j / h), y = j % h;
  return [y * w + x, y * w + x + 1];
}

/**
 * Simon Tatham's Map game id: `WxHnN[dX]:edges,colors`. Edges are run lengths (a–y, alternating
 * between no-edge and edge, starting with no-edge plus one notional extra; z = 25 without
 * switching). Colors per region: 0–3, or a–z for runs of 1–26 uncolored regions.
 */
export const sgtFormat: Format<MapPuzzle> = {
  id: "sgt",
  label: "game id (WxHnN:…)",
  detect: (t) => SGT_RE.test(t.trim()),
  parse(t) {
    const m = SGT_RE.exec(t.trim());
    if (!m) throw new Error("expected WxHnN:edges,colors");
    const w = Number(m[1]), h = m[2] ? Number(m[2]) : w;
    if (!(w >= 2 && h >= 2 && w <= 100 && h <= 100)) throw new Error("size must be between 2×2 and 100×100");
    const wh = w * h;
    const parent = Array.from({ length: wh }, (_, i) => i);
    const find = (x: number): number => (parent[x] === x ? x : (parent[x] = find(parent[x]!)));
    let pos = -1, edge = false;
    for (const ch of m[4]!) {
      const k = ch === "z" ? 25 : ch.charCodeAt(0) - 96;
      for (let i = 0; i < k; i++) {
        if (pos >= 0) {
          if (pos >= edgeCount(w, h)) throw new Error("too much data in the edge list");
          if (!edge) {
            const [a, b] = edgeCells(w, h, pos);
            parent[find(a)] = find(b);
          }
        }
        pos++;
      }
      if (ch !== "z") edge = !edge;
    }
    if (pos < edgeCount(w, h)) throw new Error("too little data in the edge list");
    const ids = new Map<number, number>();
    const map = Array.from({ length: wh }, (_, c) => {
      const root = find(c);
      if (!ids.has(root)) ids.set(root, ids.size);
      return ids.get(root)!;
    });
    const n = ids.size;
    if (m[3] && Number(m[3]) !== n) throw new Error(`the edges make ${n} regions, not ${m[3]}`);
    const given: number[] = [];
    for (const ch of m[5]!) {
      if (ch >= "0" && ch <= "3") given.push(Number(ch));
      else for (let i = 0; i <= ch.charCodeAt(0) - 97; i++) given.push(-1);
    }
    if (given.length !== n) throw new Error(`expected colors for ${n} regions, got ${given.length}`);
    return { w, h, n, map, given };
  },
  serialize(p) {
    const { w, h, map } = p;
    let edges = "", run = 1, pv = false;
    for (let i = 0; i < edgeCount(w, h); i++) {
      const [a, b] = edgeCells(w, h, i);
      const v = map[a] !== map[b];
      if (v !== pv) {
        edges += String.fromCharCode(96 + run);
        run = 1;
        pv = v;
      } else {
        if (run === 25) {
          edges += "z";
          run = 0;
        }
        run++;
      }
    }
    edges += String.fromCharCode(96 + run);
    let cols = "", empty = 0;
    for (const c of p.given) {
      if (c < 0) {
        if (empty === 26) {
          cols += "z";
          empty = 0;
        }
        empty++;
      } else {
        if (empty) cols += String.fromCharCode(96 + empty);
        empty = 0;
        cols += String(c);
      }
    }
    if (empty) cols += String.fromCharCode(96 + empty);
    return `${w}x${h}n${p.n}:${edges},${cols}`;
  },
};

// --- names, conflicts, hints ---

/** A region is named by the cell its label sits in. */
export const regionName = (p: MapPuzzle, r: number) => {
  const c = geometry(p).anchor[r]!;
  return `the region at ${boardCell(c % p.w, Math.floor(c / p.w))}`;
};

export function regionList(p: MapPuzzle, regions: readonly number[]): string {
  const g = geometry(p);
  const names = regions.slice(0, 3).map((r) => boardCell(g.anchor[r]! % p.w, Math.floor(g.anchor[r]! / p.w)));
  const rest = regions.length - names.length;
  const list = rest > 0 ? `${names.join(", ")} and ${rest} more` : names.length > 1 ? `${names.slice(0, -1).join(", ")} and ${names[names.length - 1]}` : names[0] ?? "";
  return `the ${regions.length === 1 ? "region" : "regions"} at ${list}`;
}

export function colourList(mask: number, joiner = "or"): string {
  const names = COLOUR_NAMES.filter((_, c) => mask & (1 << c));
  return names.length > 1 ? `${names.slice(0, -1).join(", ")} ${joiner} ${names[names.length - 1]}` : names[0] ?? "";
}

/** Focus payload understood by the map view. */
export interface MapFocus {
  /** Regions the hint changes. */
  regions: number[];
  /** Regions explaining why. */
  because: number[];
}

/** Rule breaks visible without knowing the answer. */
export interface Conflicts {
  /** Colored regions that share a color with a neighbor. */
  clashes: number[];
  /** Uncolored regions whose neighbors already use all four colors. */
  stuck: number[];
}

export function findConflicts(p: MapPuzzle, s: MapState): Conflicts {
  const g = geometry(p);
  const clashes: number[] = [], stuck: number[] = [];
  for (let r = 0; r < p.n; r++) {
    if (s.colours[r]! >= 0) {
      if (g.adj[r]!.some((o) => s.colours[o] === s.colours[r])) clashes.push(r);
      continue;
    }
    let used = 0;
    for (const o of g.adj[r]!) if (s.colours[o]! >= 0) used |= 1 << s.colours[o]!;
    if (used === ALL) stuck.push(r);
  }
  return { clashes, stuck };
}

/** Colors and pencil marks that disagree with the unique solution, as a hint that clears them. */
export function wrongMarksHint(p: MapPuzzle, s: MapState): Hint<MapAction> | null {
  const a = analyze(p);
  if (a.count !== 1 || !a.solution) return null;
  const sol = a.solution;
  const wrongCol: number[] = [], wrongMarks: number[] = [];
  for (let r = 0; r < p.n; r++) {
    if (p.given[r]! >= 0) continue;
    if (s.colours[r]! >= 0 && s.colours[r] !== sol[r]) wrongCol.push(r);
    else if (s.colours[r]! < 0 && s.marks[r] && !(s.marks[r]! & (1 << sol[r]!))) wrongMarks.push(r);
  }
  if (!wrongCol.length && !wrongMarks.length) return null;
  const parts: string[] = [];
  if (wrongCol.length) parts.push(`the ${wrongCol.length === 1 ? "color" : "colors"} on ${regionList(p, wrongCol)} ${wrongCol.length === 1 ? "is" : "are"} wrong`);
  if (wrongMarks.length) parts.push(`the pencil marks on ${regionList(p, wrongMarks)} leave out the right color`);
  const actions: MapAction[] = [];
  if (wrongCol.length) actions.push({ type: "colour", regions: wrongCol, colour: -1 });
  if (wrongMarks.length) actions.push({ type: "marks", regions: wrongMarks, marks: 0 });
  return { message: parts.join(", and "), focus: { regions: [...wrongCol, ...wrongMarks], because: [] } satisfies MapFocus, actions };
}

export function hint(p: MapPuzzle, s: MapState): Hint<MapAction> | null {
  const c = findConflicts(p, s);
  if (c.clashes.length) return { message: `${regionList(p, c.clashes)} ${c.clashes.length === 1 ? "has" : "have"} the same color as a neighbor`, focus: { regions: c.clashes, because: [] } satisfies MapFocus };
  if (c.stuck.length) return { message: `${regionList(p, c.stuck)} can't take any color: the neighbors use all four`, focus: { regions: c.stuck, because: [] } satisfies MapFocus };
  const a = analyze(p);
  if (a.count === 0) return { message: "this map has no solution" };
  if (a.count === 2) return { message: "this map has more than one solution, so it can need a guess" };
  return { message: "none of the techniques you have hints on applies here" };
}

function rate(p: MapPuzzle): { label: string; score: number } {
  const a = analyze(p);
  if (a.count === 0) return { label: "no solution", score: -1 };
  if (a.count === 2) return { label: "multiple solutions", score: 10 };
  if (a.level === null) return { label: "needs guessing", score: 3 };
  return { label: LEVEL_NAMES[a.level], score: a.level };
}

function generate(v: Values<typeof params>, rng: Rng, ctx: GenerateContext): Promise<MapPuzzle> {
  return generatePuzzle({
    w: v.width, h: v.height, n: v.regions,
    level: LEVEL_NAMES.indexOf(v.difficulty as (typeof LEVEL_NAMES)[number]) as Level,
  }, rng, ctx);
}

export const map: PuzzleDef<MapPuzzle, MapState, MapAction, MapInteraction, typeof params> = {
  id: "map",
  name: "map",
  aliases: ["four color", "four color", "map coloring", "map coloring", "four color theorem"],
  tags: ["logic", "regions", "coloring"],
  description: "color every region of the map with one of four colors so that no two regions that share a border have the same color.",
  generatorVersion: 1,
  params,
  presets: [
    { label: "12×10, 15 regions, easy", params: { width: 12, height: 10, regions: 15, difficulty: "easy" } },
    { label: "20×15, 30 regions, medium", params: { width: 20, height: 15, regions: 30, difficulty: "medium" } },
    { label: "20×15, 30 regions, hard", params: { width: 20, height: 15, regions: 30, difficulty: "hard" } },
    { label: "30×25, 75 regions, medium", params: { width: 30, height: 25, regions: 75, difficulty: "medium" } },
    { label: "30×25, 75 regions, hard", params: { width: 30, height: 25, regions: 75, difficulty: "hard" } },
  ],
  generate,
  formats: [sgtFormat],
  init: (p) => ({ colours: p.given.slice(), marks: p.given.map(() => 0) }),
  initInteraction: (p) => ({ cursor: Math.floor(p.h / 2) * p.w + Math.floor(p.w / 2), pencil: false }),
  reduce,
  isRetraction: (a) => (a.type === "colour" && a.colour < 0) || a.type === "toggle-mark",
  rules: () => [
    "color every region with one of four colors.",
    "regions that share a border (not just a corner) must have different colors.",
    "regions colored from the start are fixed.",
    "pencil marks are your own notes of which colors a region could still have. they don't count for anything.",
  ],
  isSolved,
  solve(p) {
    const a = analyze(p);
    return a.solution ? { colours: a.solution.slice(), marks: p.given.map(() => 0) } : null;
  },
  hint,
  rate,
  describe: (p) => `${p.w}×${p.h}, ${p.n} regions`,
};
