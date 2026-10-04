import type { Rng } from "../../core/rng";
import { defineSchema, type Values } from "../../core/schema";
import type { Format, PuzzleDef, Rating } from "../../core/types";
import { SOLIDS, align, area, faceOf, links, rollKey, squares, type Link, type SolidId, type Square } from "./geometry";

export const params = defineSchema({
  solid: {
    type: "enum", label: "solid", default: "cube",
    options: [
      { value: "cube", label: "cube" },
      { value: "tetrahedron", label: "tetrahedron" },
      { value: "octahedron", label: "octahedron" },
      { value: "icosahedron", label: "icosahedron" },
    ],
  },
  d1: { type: "int", label: "size (width, or first side of the hexagon)", default: 4, min: 1, max: 12 },
  d2: { type: "int", label: "size (height, or second side)", default: 4, min: 0, max: 12 },
});

export interface CubePuzzle {
  solid: SolidId;
  d1: number;
  d2: number;
  /** 1 per blue square, in sgt's square order. */
  blue: number[];
  /** Square the solid starts on. */
  start: number;
}

export interface CubeState {
  square: number;
  /** Solid vertex on each corner of the current square. */
  key: number[];
  /** 1 per blue face. */
  faces: number[];
  blue: number[];
  moves: number;
}

/** Roll the solid onto a neighboring square. */
export type CubeAction = { type: "roll"; to: number };

export interface CubeFocus {
  /** Squares the hinted route visits, in order. */
  route?: number[];
  /** Blue square it's heading for. */
  target?: number;
}

export interface Arena {
  squares: Square[];
  links: Link[][];
}

const arenas = new Map<string, Arena>();
export function arena(p: Pick<CubePuzzle, "solid" | "d1" | "d2">): Arena {
  const key = `${p.solid}:${p.d1}x${p.d2}`;
  let a = arenas.get(key);
  if (!a) {
    const sqs = squares(p.solid, p.d1, p.d2);
    arenas.set(key, (a = { squares: sqs, links: links(sqs) }));
  }
  return a;
}

export function roll(p: CubePuzzle, s: Pick<CubeState, "square" | "key" | "faces" | "blue">, to: number): Omit<CubeState, "moves"> | null {
  const a = arena(p);
  const link = a.links[s.square]!.find((l) => l.to === to);
  if (!link) return null;
  const solid = SOLIDS[p.solid];
  const key = rollKey(solid, a.squares, s.key, link);
  const down = faceOf(solid, key);
  const faces = s.faces.slice(), blue = s.blue.slice();
  [faces[down], blue[to]] = [blue[to]!, faces[down]!];
  return { square: to, key, faces, blue };
}

const COMPASS = ["right", "down-right", "down", "down-left", "left", "up-left", "up", "up-right"] as const;

/** Compass name for rolling from one square to a neighbor. */
export function direction(p: CubePuzzle, from: number, to: number): string {
  const a = arena(p).squares;
  const angle = Math.atan2(a[to]!.y - a[from]!.y, a[to]!.x - a[from]!.x);
  return COMPASS[((Math.round(angle / (Math.PI / 4)) % 8) + 8) % 8]!;
}

export const isComplete = (faces: readonly number[]) => faces.every(Boolean);

/** Squares each face can ever land on fall into classes; blue squares are spread evenly over them. */
export function classOf(p: Pick<CubePuzzle, "solid">, sq: Square): number {
  return p.solid === "tetrahedron" ? sq.tetraClass : p.solid === "octahedron" ? (sq.flip ? 1 : 0) : 0;
}
const classCount = (solid: SolidId) => (solid === "tetrahedron" ? 4 : solid === "octahedron" ? 2 : 1);

function checkSize(solid: SolidId, d1: number, d2: number): void {
  if (SOLIDS[solid].order === 4) {
    if (d1 < 2 || d2 < 2) throw new Error("both sides must be at least 2");
  } else if (d1 + d2 < 1) throw new Error("at least one side must be above 0");
  const sqs = squares(solid, d1, d2);
  const k = classCount(solid), per = SOLIDS[solid].faces.length / k;
  for (let c = 0; c < k; c++) {
    if (sqs.filter((s) => classOf({ solid }, s) === c).length < per) throw new Error("not enough room to place every blue square");
  }
  if (sqs.length < SOLIDS[solid].faces.length + 1) throw new Error("not enough room for the solid to start on a clear square");
}

function generate(v: Values<typeof params>, rng: Rng): CubePuzzle {
  const solid = v.solid as SolidId;
  let d1 = v.d1, d2 = v.d2;
  try { checkSize(solid, d1, d2); } catch {
    [d1, d2] = solid === "cube" ? [4, 4] : solid === "tetrahedron" ? [1, 2] : solid === "octahedron" ? [2, 2] : [3, 3];
  }
  const sqs = squares(solid, d1, d2);
  const k = classCount(solid), per = SOLIDS[solid].faces.length / k;
  const blue = sqs.map(() => 0);
  for (let c = 0; c < k; c++) {
    const pool = sqs.flatMap((s, i) => (classOf({ solid }, s) === c ? [i] : []));
    for (let j = 0; j < per; j++) blue[pool.splice(rng.int(pool.length), 1)[0]!] = 1;
  }
  const free = blue.flatMap((b, i) => (b ? [] : [i]));
  return { solid, d1, d2, blue, start: free[rng.int(free.length)]! };
}

// --- formats ---

const LETTERS: Record<string, SolidId> = { t: "tetrahedron", c: "cube", o: "octahedron", i: "icosahedron" };
const SGT_RE = /^([tcoi]?)(\d+)(?:x(\d+))?:([0-9A-Fa-f]+),(\d+)$/;

/** Simon Tatham's Cube game id: `[t|c|o|i]D1xD2:` a hex bitmap of blue squares (high bit first), `,` and the start square. */
export const sgtFormat: Format<CubePuzzle> = {
  id: "sgt",
  label: "sgt game id (c4x4:hex,start)",
  detect: (t) => SGT_RE.test(t.trim()),
  parse(text) {
    const m = SGT_RE.exec(text.trim());
    if (!m) throw new Error("expected e.g. c4x4:0F01,5");
    const solid = LETTERS[m[1] || "c"]!;
    const d1 = Number(m[2]), d2 = Number(m[3] ?? m[2]);
    if (d1 > 30 || d2 > 30) throw new Error("size out of range");
    checkSize(solid, d1, d2);
    const n = area(solid, d1, d2);
    const hex = m[4]!;
    if (hex.length < Math.ceil(n / 4)) throw new Error(`expected ${Math.ceil(n / 4)} hex digits`);
    const blue = Array.from({ length: n }, (_, i) => (parseInt(hex[i >> 2]!, 16) >> (3 - (i & 3))) & 1);
    const want = SOLIDS[solid].faces.length;
    if (blue.reduce((a, b) => a + b, 0) !== want) throw new Error(`a ${solid} needs exactly ${want} blue squares`);
    const start = Number(m[5]);
    if (start >= n) throw new Error("start square is off the arena");
    return { solid, d1, d2, blue, start };
  },
  serialize(p) {
    let hex = "";
    for (let i = 0; i < p.blue.length; i += 4) {
      let v = 0;
      for (let j = 0; j < 4; j++) v = (v << 1) | (p.blue[i + j] ?? 0);
      hex += v.toString(16).toUpperCase();
    }
    return `${p.solid[0]}${p.d1}x${p.d2}:${hex},${p.start}`;
  },
};

export function initState(p: CubePuzzle): CubeState {
  const sq = arena(p).squares[p.start]!;
  const key = align(SOLIDS[p.solid], sq);
  if (!key) throw new Error("the solid doesn't fit its starting square");
  return { square: p.start, key, faces: SOLIDS[p.solid].faces.map(() => 0), blue: p.blue.slice(), moves: 0 };
}

const ratingCache = new WeakMap<CubePuzzle, Rating>();
function rate(p: CubePuzzle): Rating {
  let r = ratingCache.get(p);
  if (!r) {
    const faces = SOLIDS[p.solid].faces.length;
    r = { label: `${faces} faces`, score: faces * 100 + arena(p).squares.length };
    ratingCache.set(p, r);
  }
  return r;
}

export const SOLID_NAMES: Record<SolidId, string> = { tetrahedron: "tetrahedron", cube: "cube", octahedron: "octahedron", icosahedron: "icosahedron" };

export const cube: PuzzleDef<CubePuzzle, CubeState, CubeAction, null, typeof params> = {
  id: "cube",
  name: "cube",
  aliases: ["cube", "rolling cube", "rolling die"],
  tags: ["moves", "3d", "rolling"],
  description: "roll a solid around a grid. landing on a blue square picks the blue up onto the face underneath, and putting a blue face down leaves it behind. make every face blue.",
  generatorVersion: 1,
  params,
  presets: [
    { label: "cube", params: { solid: "cube", d1: 4, d2: 4 } },
    { label: "tetrahedron", params: { solid: "tetrahedron", d1: 1, d2: 2 } },
    { label: "octahedron", params: { solid: "octahedron", d1: 2, d2: 2 } },
    { label: "icosahedron", params: { solid: "icosahedron", d1: 3, d2: 3 } },
  ],
  generate,
  formats: [sgtFormat],
  init: initState,
  reduce(p, s, a) {
    if (a.type !== "roll") return s;
    const next = roll(p, s, a.to);
    return next ? { ...next, moves: s.moves + 1 } : s;
  },
  isSolved: (_p, s) => isComplete(s.faces),
  describeAction: (p, a, before, after) => {
    if (!arena(p).links[before.square]!.some((l) => l.to === a.to)) return "roll";
    const gained = after.faces.filter(Boolean).length - before.faces.filter(Boolean).length;
    const what = after.moves - before.moves !== 1 || !gained ? "" : gained > 0 ? ", picks up blue" : ", sets blue down";
    return `roll ${direction(p, before.square, a.to)}${what}`;
  },
  rate,
  rules: (p) => [
    `the ${SOLID_NAMES[p.solid]} rolls over one edge at a time onto a neighboring square.`,
    "whenever it lands, the face underneath and the square swap colors: a blue square is picked up by a plain face, and a blue face set down on a plain square stays behind.",
    `make all ${SOLIDS[p.solid].faces.length} faces blue.`,
  ],
  describe: (p) => (SOLIDS[p.solid].order === 4 ? `${SOLID_NAMES[p.solid]}, ${p.d1}×${p.d2}` : `${SOLID_NAMES[p.solid]}, ${p.d1}·${p.d2} hexagon`),
};
