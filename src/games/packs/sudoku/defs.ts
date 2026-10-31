import { defineSchema, effective } from "../../core/schema";
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

const CLUE_VARIANTS = ["killer", "keen", "towers", "unequal", "thermo", "arrow", "kropki", "xv", "littlekiller", "whispers", "renban"];

/** Clue types whose full candidate sets are large and weak, so stripping givens first is slow. */
const DENSE = new Set(["kropki", "littlekiller"]);

/** Clue types that are puzzles of their own when given alone (calcudoku, skyscrapers, futoshiki): no givens unless asked. */
const SELF = ["keen", "towers", "unequal"];

const sudokuParams = defineSchema({
  size: { type: "int", label: "size", default: 9, min: 3, max: 9 },
  regions: {
    type: "enum", label: "regions", default: (v) => (boxDims(Number(v.size)) ? "boxes" : "none"),
    options: (v) => [
      ...(boxDims(Number(v.size)) ? [{ value: "boxes", label: "boxes", description: "each box holds each digit once (sudoku)" }] : []),
      { value: "jigsaw", label: "jigsaw", description: "irregular regions instead of boxes" },
      { value: "none", label: "none", description: "rows and columns only (a latin square: calcudoku, skyscrapers, futoshiki)" },
    ],
  },
  variants: {
    type: "set", label: "variants", default: [],
    options: [
      { value: "diagonal", label: "diagonals", description: "both main diagonals hold each digit once" },
      { value: "antiknight", label: "anti-knight" },
      { value: "antiking", label: "anti-king" },
      { value: "nonconsecutive", label: "non-consecutive" },
      { value: "killer", label: "killer cages" },
      { value: "keen", label: "calcudoku cages", description: "a cage's digits make its number with its sign: 6+, 2÷ (KenKen)" },
      { value: "towers", label: "skyscraper clues", description: "a number outside says how many buildings you see from there" },
      { value: "unequal", label: "inequality signs", description: "< and > between cells (futoshiki)" },
      { value: "thermo", label: "thermometers" },
      { value: "arrow", label: "arrows" },
      { value: "kropki", label: "kropki dots" },
      { value: "xv", label: "XV" },
      { value: "littlekiller", label: "little killers" },
      { value: "whispers", label: "whisper lines" },
      { value: "renban", label: "renban lines" },
    ],
  },
  givens: {
    type: "bool", label: "digits given at the start", description: "off: the clues alone decide it",
    default: (v) => !(v.variants as string[]).some((x) => SELF.includes(x)),
  },
  difficulty: { ...DIFFICULTY, default: (v: Record<string, unknown>) => ((v.variants as string[]).includes("keen") ? "any" : "medium") },
  // rotational by default: it makes the board look like the classic sudoku most people know
  symmetry: {
    type: "enum", label: "given symmetry", default: "rotational", when: (v) => !!v.givens,
    options: [
      { value: "none", label: "none" },
      { value: "rotational", label: "rotational" },
      { value: "mirror", label: "mirror" },
      { value: "diagonal", label: "diagonal" },
    ],
  },
  cage: { type: "int", label: "largest killer cage", default: 5, min: 2, max: 9, when: (v) => (v.variants as string[]).includes("killer") },
  keenCage: { type: "int", label: "largest calcudoku cage", default: 4, min: 2, max: 6, when: (v) => (v.variants as string[]).includes("keen") },
  ops: {
    type: "set", label: "calcudoku operations", default: ["+", "-", "*", "/"], when: (v) => (v.variants as string[]).includes("keen"),
    options: [{ value: "+", label: "+" }, { value: "-", label: "−" }, { value: "*", label: "×" }, { value: "/", label: "÷" }],
  },
});

/**
 * Every latin-square puzzle as settings of one: sudoku and its variants, calcudoku (KenKen),
 * skyscrapers and futoshiki, and any mix of their clues (killer skyscrapers, futoshiki with boxes).
 */
export const sudoku = latinDef({
  id: "sudoku",
  name: "sudoku",
  description: "put a digit in every empty cell so that no row, column or region has the same digit twice. clues add rules: cages that add up, buildings to see, signs between cells. the rules of each puzzle are listed below.",
  aliases: ["number place", "solo", "killer sudoku", "jigsaw sudoku", "thermo sudoku", "variant sudoku", "calcudoku", "kenken", "keen", "mathdoku", "kendoku", "skyscrapers", "towers", "futoshiki", "unequal", "inequality", "hutoshiki", "latin square"],
  tags: ["logic", "grid", "numbers", "latin square", "variants"],
  generatorVersion: 2,
  params: sudokuParams,
  implied: ["latin", "boxes"],
  presets: [
    { label: "classic", params: { size: 9, variants: [] } },
    { label: "killer", params: { size: 9, variants: ["killer"] } },
    { label: "diagonal", params: { size: 9, variants: ["diagonal"] } },
    { label: "jigsaw", params: { size: 9, regions: "jigsaw" } },
    { label: "thermo", params: { size: 9, variants: ["thermo"] } },
    { label: "arrows", params: { size: 9, variants: ["arrow"] } },
    { label: "kropki", params: { size: 9, variants: ["kropki"] } },
    { label: "anti-knight", params: { size: 9, variants: ["antiknight"] } },
    { label: "little killer", params: { size: 9, variants: ["littlekiller"] } },
    { label: "6×6", params: { size: 6, variants: [] } },
    { label: "4×4", params: { size: 4, variants: [], difficulty: "easy" } },
    { label: "calcudoku (KenKen) 4×4", params: { size: 4, regions: "none", variants: ["keen"] } },
    { label: "calcudoku (KenKen) 6×6", params: { size: 6, regions: "none", variants: ["keen"] } },
    { label: "calcudoku (KenKen) 9×9", params: { size: 9, regions: "none", variants: ["keen"] } },
    { label: "calcudoku, addition only", params: { size: 6, regions: "none", variants: ["keen"], ops: ["+"] } },
    { label: "skyscrapers 4×4", params: { size: 4, regions: "none", variants: ["towers"], difficulty: "easy" } },
    { label: "skyscrapers 5×5", params: { size: 5, regions: "none", variants: ["towers"] } },
    { label: "skyscrapers 6×6", params: { size: 6, regions: "none", variants: ["towers"], difficulty: "hard" } },
    { label: "futoshiki 4×4", params: { size: 4, regions: "none", variants: ["unequal"], difficulty: "easy" } },
    { label: "futoshiki 5×5", params: { size: 5, regions: "none", variants: ["unequal"] } },
    { label: "futoshiki 7×7", params: { size: 7, regions: "none", variants: ["unequal"], difficulty: "hard" } },
    { label: "skyscraper sudoku", params: { size: 6, variants: ["towers"] } },
  ],
  async generate(given, rng, ctx) {
    const v = effective(sudokuParams, given);
    const n = v.size;
    const variants = new Set(v.variants);
    const dims = boxDims(n);
    const region = v.regions === "boxes" && !dims ? "none" : v.regions;
    const globals = (r: typeof rng): ConstraintSpec[] => [
      { type: "latin" },
      ...(region === "jigsaw" ? [{ type: "regions", ids: jigsaw(n, r) } as ConstraintSpec] : region === "boxes" ? [{ type: "boxes", w: dims![0], h: dims![1] } as ConstraintSpec] : []),
      ...[...variants].flatMap((x) => GLOBAL_VARIANTS[x] ?? []),
    ];
    const clues: ClueRequest[] = CLUE_VARIANTS.filter((x) => variants.has(x)).map((type) => ({ type, options: { maxCage: type === "keen" ? v.keenCage : v.cage, ...(type === "keen" ? { ops: v.ops.length ? v.ops : ["+"] } : {}) } }));
    const keen = variants.has("keen");
    return generateLatin({
      n, globals, clues,
      givens: v.givens ? "all" : "none",
      ...(v.givens ? { symmetry: v.symmetry as Symmetry, order: clues.some((c) => DENSE.has(c.type)) ? "mixed" as const : "givens-first" as const } : {}),
      target: target(v.difficulty),
      ...(keen && !v.givens ? { cap: false, attempts: v.difficulty === "any" ? 4 : 12 } : {}),
    }, rng, ctx);
  },
});

export const latinDefs = [sudoku];
