import { defineSchema } from "../../core/schema";
import { boxDims, jigsaw } from "./engine/geometry";
import { generateLatin, type ClueRequest, type Symmetry } from "./engine/generate";
import type { ConstraintSpec } from "./engine/types";
import { latinDef } from "./puzzle";

const DIFFICULTY = {
  type: "enum",
  label: "difficulty",
  default: "medium",
  options: [
    { value: "any", label: "any" },
    { value: "easy", label: "easy", description: "singles only" },
    { value: "medium", label: "medium", description: "plus intersections and simple constraint logic" },
    { value: "hard", label: "hard", description: "plus subsets, x-wings and short chains" },
    { value: "expert", label: "expert", description: "plus fish and long chains" },
    { value: "extreme", label: "extreme", description: "needs trial and error" },
  ],
} as const;

const target = (d: string) => (d === "any" ? null : d);

/** Global variants shape the solution; clue variants are read off it. */
const GLOBAL_VARIANTS: Record<string, ConstraintSpec[]> = {
  diagonal: [{ type: "diagonal" }, { type: "diagonal", anti: true }],
  antiknight: [{ type: "antiknight" }],
  antiking: [{ type: "antiking" }],
  nonconsecutive: [{ type: "nonconsecutive" }],
};

const CLUE_VARIANTS = ["killer", "thermo", "arrow", "kropki", "xv", "littlekiller", "whispers", "renban"];

/** Clue types whose full candidate sets are large and weak, so stripping givens first is slow. */
const DENSE = new Set(["kropki", "littlekiller"]);

const sudokuParams = defineSchema({
  size: {
    type: "enum", label: "size", default: "9",
    options: [{ value: "4", label: "4×4" }, { value: "6", label: "6×6" }, { value: "8", label: "8×8" }, { value: "9", label: "9×9" }],
  },
  variants: {
    type: "set", label: "variants", default: [],
    options: [
      { value: "diagonal", label: "diagonals", description: "both main diagonals hold each digit once" },
      { value: "jigsaw", label: "jigsaw", description: "irregular regions replace boxes" },
      { value: "antiknight", label: "anti-knight" },
      { value: "antiking", label: "anti-king" },
      { value: "nonconsecutive", label: "non-consecutive" },
      { value: "killer", label: "killer cages" },
      { value: "thermo", label: "thermometers" },
      { value: "arrow", label: "arrows" },
      { value: "kropki", label: "kropki dots" },
      { value: "xv", label: "XV" },
      { value: "littlekiller", label: "little killers" },
      { value: "whispers", label: "whisper lines" },
      { value: "renban", label: "renban lines" },
    ],
  },
  difficulty: DIFFICULTY,
  symmetry: {
    type: "enum", label: "given symmetry", default: "rotational",
    options: [
      { value: "none", label: "none" },
      { value: "rotational", label: "rotational" },
      { value: "mirror", label: "mirror" },
      { value: "diagonal", label: "diagonal" },
    ],
  },
  cage: { type: "int", label: "largest killer cage", default: 5, min: 2, max: 9, when: (v) => (v.variants as string[]).includes("killer") },
});

export const sudoku = latinDef({
  id: "sudoku",
  name: "sudoku",
  description: "fill the grid so every row, column and box holds each digit once. with variants.",
  generatorVersion: 1,
  params: sudokuParams,
  implied: ["latin", "boxes"],
  presets: [
    { label: "classic", params: { size: "9", variants: [] } },
    { label: "killer", params: { size: "9", variants: ["killer"] } },
    { label: "diagonal", params: { size: "9", variants: ["diagonal"] } },
    { label: "jigsaw", params: { size: "9", variants: ["jigsaw"] } },
    { label: "thermo", params: { size: "9", variants: ["thermo"] } },
    { label: "arrows", params: { size: "9", variants: ["arrow"] } },
    { label: "kropki", params: { size: "9", variants: ["kropki"] } },
    { label: "anti-knight", params: { size: "9", variants: ["antiknight"] } },
    { label: "little killer", params: { size: "9", variants: ["littlekiller"] } },
    { label: "6×6", params: { size: "6", variants: [] } },
    { label: "4×4", params: { size: "4", variants: [], difficulty: "easy" } },
  ],
  async generate(v, rng, ctx) {
    const n = Number(v.size);
    const variants = new Set(v.variants);
    const dims = boxDims(n)!;
    const globals = (r: typeof rng): ConstraintSpec[] => [
      { type: "latin" },
      variants.has("jigsaw") ? { type: "regions", ids: jigsaw(n, r) } : { type: "boxes", w: dims[0], h: dims[1] },
      ...[...variants].flatMap((x) => GLOBAL_VARIANTS[x] ?? []),
    ];
    const clues: ClueRequest[] = CLUE_VARIANTS.filter((x) => variants.has(x)).map((type) => ({ type, options: { maxCage: v.cage } }));
    return generateLatin({
      n, globals, clues,
      givens: "all",
      symmetry: v.symmetry as Symmetry,
      order: clues.some((c) => DENSE.has(c.type)) ? "mixed" : "givens-first",
      target: target(v.difficulty),
    }, rng, ctx);
  },
});

const sizeField = (def: number) => ({ type: "int", label: "size", default: def, min: 3, max: 9 } as const);

export const keen = latinDef({
  id: "keen",
  name: "keen",
  description: "a latin square split into cages; each cage's digits make its number with its operation.",
  generatorVersion: 1,
  implied: ["latin", "keen"],
  params: defineSchema({
    size: sizeField(6),
    cage: { type: "int", label: "largest cage", default: 4, min: 2, max: 6 },
    ops: {
      type: "set", label: "operations", default: ["+", "-", "*", "/"],
      options: [{ value: "+", label: "+" }, { value: "-", label: "−" }, { value: "*", label: "×" }, { value: "/", label: "÷" }],
    },
    difficulty: { ...DIFFICULTY, default: "any" },
  }),
  presets: [
    { label: "4×4", params: { size: 4 } },
    { label: "6×6", params: { size: 6 } },
    { label: "9×9", params: { size: 9 } },
    { label: "addition only", params: { size: 6, ops: ["+"] } },
  ],
  generate: (v, rng, ctx) => generateLatin({
    n: v.size,
    globals: () => [{ type: "latin" }],
    clues: [{ type: "keen", options: { maxCage: v.cage, ops: v.ops.length ? v.ops : ["+"] } }],
    givens: "none",
    target: target(v.difficulty),
    cap: false,
    attempts: v.difficulty === "any" ? 4 : 12,
  }, rng, ctx),
});

export const towers = latinDef({
  id: "towers",
  name: "towers",
  description: "a latin square of building heights; edge clues count the buildings visible from there.",
  generatorVersion: 1,
  implied: ["latin", "towers"],
  params: defineSchema({ size: sizeField(5), difficulty: DIFFICULTY }),
  presets: [
    { label: "4×4", params: { size: 4, difficulty: "easy" } },
    { label: "5×5", params: { size: 5 } },
    { label: "6×6", params: { size: 6, difficulty: "hard" } },
  ],
  generate: (v, rng, ctx) => generateLatin({
    n: v.size,
    globals: () => [{ type: "latin" }],
    clues: [{ type: "towers" }],
    givens: "none",
    target: target(v.difficulty),
  }, rng, ctx),
});

export const unequal = latinDef({
  id: "unequal",
  name: "unequal",
  description: "a latin square with inequality signs between some neighbouring cells.",
  generatorVersion: 1,
  implied: ["latin", "unequal"],
  params: defineSchema({ size: sizeField(5), difficulty: DIFFICULTY }),
  presets: [
    { label: "4×4", params: { size: 4, difficulty: "easy" } },
    { label: "5×5", params: { size: 5 } },
    { label: "7×7", params: { size: 7, difficulty: "hard" } },
  ],
  generate: (v, rng, ctx) => generateLatin({
    n: v.size,
    globals: () => [{ type: "latin" }],
    clues: [{ type: "unequal" }],
    givens: "none",
    target: target(v.difficulty),
  }, rng, ctx),
});

export const latinDefs = [sudoku, keen, towers, unequal];
export const LATIN_IDS = latinDefs.map((d) => d.id);
