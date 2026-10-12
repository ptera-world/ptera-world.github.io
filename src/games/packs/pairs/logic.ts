import type { Rng } from "../../core/rng";
import { defineSchema, type Values } from "../../core/schema";
import type { Format, PuzzleDef, Rating } from "../../core/types";
import { cellName } from "../../lib/grid-kit/names";

export const params = defineSchema({
  width: { type: "int", label: "width", default: 4, min: 2, max: 7 },
  height: { type: "int", label: "height", default: 4, min: 2, max: 7 },
  set: {
    type: "enum", label: "cards that match", default: "2",
    options: [{ value: "2", label: "pairs" }, { value: "3", label: "triples" }],
    description: "how many cards of a kind you flip to take them off the table",
  },
});

export interface PairsPuzzle {
  w: number;
  h: number;
  /** Cards of one kind that match. */
  set: number;
  /** Row-major kind of each card (0 up); -1 where there is no card because the cells don't divide into sets. */
  faces: number[];
}

export interface PairsState {
  /** Cards showing now; a turn in progress, or a failed one waiting for the next flip to hide it. */
  up: number[];
  /** 1 where the cards are matched and out of play. */
  done: number[];
  /** 1 where the card has been face up at some point, matched or not. */
  seen: number[];
  flips: number;
}

export type PairsAction = { type: "flip"; cell: number };

export interface PairsInteraction {
  cursor: number;
}

export interface PairsFocus {
  cells: number[];
}

export const SHAPES = ["circle", "square", "triangle", "diamond", "plus", "star", "hexagon", "ring"] as const;
export const COLOURS = ["red", "yellow", "green", "blue", "orange", "purple"] as const;
export const shapeOf = (kind: number): number => kind % SHAPES.length;
export const colourOf = (kind: number): number => kind % COLOURS.length;
export const kindName = (kind: number): string => `${COLOURS[colourOf(kind)]} ${SHAPES[shapeOf(kind)]}`;

export const kindCount = (p: Pick<PairsPuzzle, "w" | "h" | "set">): number => Math.floor((p.w * p.h) / p.set);

/** True while cards of different kinds are showing; the next flip hides them first. */
export const failed = (p: PairsPuzzle, s: PairsState): boolean => s.up.length >= 2 && s.up.some((c) => p.faces[c] !== p.faces[s.up[0]!]);

/** Cells of each kind that are still in play, by kind. */
export function remaining(p: PairsPuzzle, s: PairsState): Map<number, number[]> {
  const out = new Map<number, number[]>();
  p.faces.forEach((k, c) => {
    if (k < 0 || s.done[c]) return;
    const l = out.get(k);
    if (l) l.push(c);
    else out.set(k, [c]);
  });
  return out;
}

export function reduce(p: PairsPuzzle, s: PairsState, a: PairsAction): PairsState {
  const c = a.cell;
  if (a.type !== "flip" || !Number.isInteger(c) || c < 0 || c >= p.faces.length || p.faces[c]! < 0 || s.done[c] || (s.up.includes(c) && !failed(p, s))) return s;
  const up = [...(failed(p, s) ? [] : s.up), c];
  const seen = s.seen.slice();
  seen[c] = 1;
  if (up.length === p.set && up.every((x) => p.faces[x] === p.faces[c])) {
    const done = s.done.slice();
    for (const x of up) done[x] = 1;
    return { up: [], done, seen, flips: s.flips + 1 };
  }
  return { up, done: s.done, seen, flips: s.flips + 1 };
}

export const isSolved = (p: PairsPuzzle, s: PairsState): boolean => p.faces.every((k, c) => k < 0 || s.done[c] === 1);

/** The flips that take every card still in play off the table, finishing a turn in progress first. */
export function revealFlips(p: PairsPuzzle, s: PairsState): PairsAction[] {
  const live = failed(p, s) ? { ...s, up: [] } : s;
  const started = live.up.length ? p.faces[live.up[0]!] : -1;
  const groups = [...remaining(p, live)].sort(([a], [b]) => Number(b === started) - Number(a === started));
  return groups.flatMap(([, cells]) => cells.filter((cell) => !live.up.includes(cell)).map((cell): PairsAction => ({ type: "flip", cell })));
}

function generate(v: Values<typeof params>, rng: Rng): PairsPuzzle {
  const set = Number(v.set);
  const cells = v.width * v.height;
  const kinds = Math.floor(cells / set);
  const faces: number[] = [];
  for (let k = 0; k < kinds; k++) for (let i = 0; i < set; i++) faces.push(k);
  while (faces.length < cells) faces.push(-1);
  return { w: v.width, h: v.height, set, faces: rng.shuffle(faces) };
}

const HEAD_RE = /^\s*(\d+)\s*x\s*(\d+)\s*,\s*([23])\s*$/i;

/** Plain layout: "4x3, 2" then one line per row of kind numbers (0 up, "." for no card). */
export const layoutFormat: Format<PairsPuzzle> = {
  id: "layout",
  label: "layout (size line, then a row of kind numbers per line)",
  detect: (t) => HEAD_RE.test(t.split(/\r?\n/)[0] ?? ""),
  parse(text) {
    const [head, ...rows] = text.trim().split(/\r?\n/);
    const m = HEAD_RE.exec(head ?? "");
    if (!m) throw new Error("expected a first line like 4x3, 2 (width x height, cards that match)");
    const w = Number(m[1]), h = Number(m[2]), set = Number(m[3]);
    if (w < 2 || w > 7 || h < 2 || h > 7) throw new Error("width and height run from 2 to 7");
    const lines = rows.map((r) => r.trim()).filter(Boolean);
    if (lines.length !== h) throw new Error(`expected ${h} rows, got ${lines.length}`);
    const faces = lines.flatMap((l) => {
      const cells = l.split(/\s+/).map((x) => (x === "." ? -1 : Number(x)));
      if (cells.length !== w || cells.some((x) => !Number.isInteger(x) || x < -1)) throw new Error(`each row needs ${w} numbers or dots`);
      return cells;
    });
    const count = new Map<number, number>();
    for (const k of faces) if (k >= 0) count.set(k, (count.get(k) ?? 0) + 1);
    for (const [k, n] of count) if (n !== set) throw new Error(`kind ${k} appears ${n} times, not ${set}`);
    if (count.size > 24) throw new Error("at most 24 kinds");
    return { w, h, set, faces };
  },
  serialize: (p) => `${p.w}x${p.h}, ${p.set}\n${Array.from({ length: p.h }, (_, r) => p.faces.slice(r * p.w, (r + 1) * p.w).map((k) => (k < 0 ? "." : String(k))).join(" ")).join("\n")}`,
};

function rate(p: PairsPuzzle): Rating {
  const n = kindCount(p);
  return { label: `${n} ${p.set === 2 ? "pairs" : "triples"}`, score: n * (p.set - 1) };
}

export const pairs: PuzzleDef<PairsPuzzle, PairsState, PairsAction, PairsInteraction, typeof params> = {
  id: "pairs",
  name: "Pairs",
  aliases: ["memory", "concentration", "match the cards", "matching pairs"],
  tags: ["memory", "cards"],
  description: "all the cards lie face down. flip two at a time to find the ones that match; a match leaves the table, a miss stays showing until your next flip. clear them all.",
  generatorVersion: 1,
  params,
  presets: [
    { label: "small (4 x 3)", params: { width: 4, height: 3 } },
    { label: "medium (4 x 4)", params: { width: 4, height: 4 } },
    { label: "large (6 x 5)", params: { width: 6, height: 5 } },
    { label: "huge (7 x 6)", params: { width: 7, height: 6 } },
    { label: "triples (6 x 4)", params: { width: 6, height: 4, set: "3" } },
  ],
  generate,
  formats: [layoutFormat],
  init: (p) => ({ up: [], done: p.faces.map(() => 0), seen: p.faces.map(() => 0), flips: 0 }),
  initInteraction: () => ({ cursor: 0 }),
  reduce,
  isSolved,
  solve: (p, s) => ({ moves: revealFlips(p, s) }),
  aims: (_p, step, target) => typeof target === "number" && step.actions.some((a) => (a as PairsAction).cell === target),
  rate,
  rules: (p) => [
    `${p.faces.filter((k) => k >= 0).length} cards lie face down, ${p.set === 2 ? "two" : "three"} of each kind.`,
    `flip cards one at a time. when ${p.set === 2 ? "two" : "three"} you flip in a row are the same kind, they leave the table.`,
    p.set === 2
      ? "if the second card is different, both stay showing until your next flip, which turns them back down first."
      : "as soon as a card is different from the first, they all stay showing until your next flip, which turns them back down first.",
    "hints use only cards you have already seen.",
  ],
  describe: (p) => `${p.w} x ${p.h}, ${p.set === 2 ? "pairs" : "triples"}`,
  describeAction: (p, a, before) => `flip ${cellName(p, a.cell)}${before.seen[a.cell] ? ` (${kindName(p.faces[a.cell]!)})` : ""}`,
};
