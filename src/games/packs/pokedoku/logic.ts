import type { Rng } from "../../core/rng";
import { defineSchema, type Values } from "../../core/schema";
import type { GenerateContext, PuzzleDef } from "../../core/types";
import { facet, facets, FACET_KINDS, type Facet } from "../../lib/pokemon/facets";
import { DEFAULT_POOL, POOL_PRESETS, poolField, poolOf } from "../../lib/pokemon/pool";
import type { PokemonDataset, PokemonItem } from "../../lib/pokemon/types";

export interface GridPuzzle {
  /** Facet ids (lib/pokemon/facets) down the left and across the top. */
  rows: string[];
  cols: string[];
  /** Filter query for which pokémon are in play: only these are offered and count as answers. */
  pool: string;
  /** Guesses in all, right and wrong. */
  guesses: number;
}

export interface GridState {
  /** Item id named in each square (row-major), null while empty. */
  cells: (string | null)[];
  /** Wrong guesses, in order. */
  wrong: { cell: number; item: string }[];
}

export type GridAction = { type: "guess"; cell: number; item: string };

export interface GridInteraction {
  /** The selected square. */
  cursor: number;
}

/** Kinds asked about unless the player picks others: close to pokedoku's categories. */
export const DEFAULT_KINDS = ["type", "typing", "gen", "class", "evo", "forms", "size", "stats"];

/** How often each kind is drawn relative to the others; types dominate, as on pokedoku. */
const KIND_WEIGHT: Record<string, number> = { type: 6, gen: 2 };

/** A facet that fits more than this share of the pool says too little to be a criterion. */
const BROAD = 0.6;

export type Dataset = () => PokemonDataset | undefined;

export function needDataset(get: Dataset): PokemonDataset {
  const ds = get();
  if (!ds) throw new Error("the pokémon data pack isn't loaded");
  return ds;
}

export function makeParams(get: Dataset) {
  return defineSchema({
    rows: { type: "int", label: "rows", default: 3, min: 2, max: 4 },
    cols: { type: "int", label: "columns", default: 3, min: 2, max: 4 },
    misses: { type: "int", label: "wrong guesses allowed", default: 0, min: 0, max: 30, description: "on top of one guess per square; a wrong guess uses one up" },
    answers: { type: "int", label: "fewest answers a square may have", default: 3, min: 1, max: 50 },
    difficulty: {
      type: "enum", label: "squares", default: "normal",
      options: [
        { value: "easy", label: "wide (many answers)" },
        { value: "normal", label: "mixed" },
        { value: "hard", label: "narrow (few answers)" },
      ],
    },
    kinds: { type: "set", label: "what rows and columns ask", default: DEFAULT_KINDS, options: FACET_KINDS.filter((k) => k.value !== "family") },
    pool: poolField(get),
  });
}

export type GridParams = Values<ReturnType<typeof makeParams>>;

/** What a puzzle means against the dataset: the pool and each square's answers. Cached per puzzle. */
export interface Solved {
  pool: PokemonItem[];
  byId: Map<string, PokemonItem>;
  rows: Facet[];
  cols: Facet[];
  /** Item ids fitting each square (row-major), in dex order. */
  answers: string[][];
}

const solvedCache = new WeakMap<GridPuzzle, Solved>();

export function analyse(ds: PokemonDataset, p: GridPuzzle): Solved {
  let a = solvedCache.get(p);
  if (a) return a;
  const pool = poolOf(ds, p.pool, 0);
  const rows = p.rows.map((id) => facet(ds, id)), cols = p.cols.map((id) => facet(ds, id));
  const answers = rows.flatMap((r) => cols.map((c) => pool.filter((it) => r.test(it) && c.test(it)).map((it) => it.id)));
  a = { pool, byId: new Map(pool.map((it) => [it.id, it])), rows, cols, answers };
  solvedCache.set(p, a);
  return a;
}

export const fits = (a: Solved, cell: number, item: string): boolean => a.answers[cell]!.includes(item);

export const used = (s: GridState): number => s.cells.filter((c) => c !== null).length + s.wrong.length;
export const left = (p: GridPuzzle, s: GridState): number => p.guesses - used(s);
export const isSolved = (_p: GridPuzzle, s: GridState): boolean => s.cells.every((c) => c !== null);
export const isOver = (p: GridPuzzle, s: GridState): boolean => isSolved(p, s) || left(p, s) <= 0;

/** Rarity of a square, as a percentage: 100 ÷ how many pokémon in play fit it; an empty square is 100. */
export function cellRarity(a: Solved, s: GridState, cell: number): number {
  return s.cells[cell] === null ? 100 : 100 / Math.max(1, a.answers[cell]!.length);
}

export function rarity(a: Solved, s: GridState): number {
  return Math.round(s.cells.reduce((sum, _, c) => sum + cellRarity(a, s, c), 0));
}

export function reduce(a: Solved, p: GridPuzzle, s: GridState, act: GridAction): GridState {
  if (act.type !== "guess" || isOver(p, s)) return s;
  const { cell, item } = act;
  if (!Number.isInteger(cell) || cell < 0 || cell >= s.cells.length || s.cells[cell] !== null) return s;
  if (!a.byId.has(item) || s.cells.includes(item) || s.wrong.some((w) => w.cell === cell && w.item === item)) return s;
  if (fits(a, cell, item)) {
    const cells = s.cells.slice();
    cells[cell] = item;
    return { ...s, cells };
  }
  return { ...s, wrong: [...s.wrong, { cell, item }] };
}

/**
 * A distinct pokémon for every square, keeping the ones already named, or null if none exists
 * (Kuhn's augmenting paths: squares on one side, pokémon on the other).
 */
export function assignment(answers: readonly (readonly string[])[], fixed: readonly (string | null)[] = []): string[] | null {
  const owner = new Map<string, number>();
  const out: (string | null)[] = answers.map((_, c) => fixed[c] ?? null);
  for (const [c, id] of out.entries()) if (id) owner.set(id, c);
  const tryCell = (c: number, seen: Set<string>): boolean => {
    for (const id of answers[c]!) {
      if (seen.has(id)) continue;
      seen.add(id);
      const o = owner.get(id);
      if (o !== undefined && fixed[o]) continue;
      if (o === undefined || tryCell(o, seen)) {
        owner.set(id, c);
        out[c] = id;
        return true;
      }
    }
    return false;
  };
  for (let c = 0; c < answers.length; c++) if (!out[c] && !tryCell(c, new Set())) return null;
  return out as string[];
}

// --- generation ---

/** Bit set over the pool. */
class Bits {
  readonly w: Uint32Array;
  readonly count: number;
  constructor(n: number, idx: readonly number[]) {
    this.w = new Uint32Array((n + 31) >>> 5);
    for (const i of idx) this.w[i >>> 5]! |= 1 << (i & 31);
    this.count = idx.length;
  }
  and(o: Bits): number {
    let n = 0;
    for (let i = 0; i < this.w.length; i++) {
      let x = this.w[i]! & o.w[i]!;
      x -= (x >>> 1) & 0x55555555;
      x = (x & 0x33333333) + ((x >>> 2) & 0x33333333);
      n += (((x + (x >>> 4)) & 0x0f0f0f0f) * 0x01010101) >>> 24;
    }
    return n;
  }
}

interface Cand {
  f: Facet;
  bits: Bits;
}

/** True if one of the two holds wherever the other does (the narrower one adds nothing). */
const nested = (a: Cand, b: Cand) => a.bits.and(b.bits) === Math.min(a.bits.count, b.bits.count);

function pickWeighted(rng: Rng, cands: readonly Cand[]): Cand | null {
  if (!cands.length) return null;
  const kinds = [...new Set(cands.map((c) => c.f.kind))];
  const weights = kinds.map((k) => KIND_WEIGHT[k] ?? 1);
  let r = rng.next() * weights.reduce((x, y) => x + y, 0);
  let kind = kinds[kinds.length - 1]!;
  for (const [i, k] of kinds.entries()) {
    r -= weights[i]!;
    if (r < 0) { kind = k; break; }
  }
  return rng.pick(cands.filter((c) => c.f.kind === kind));
}

export async function generate(ds: PokemonDataset, v: GridParams, rng: Rng, ctx: GenerateContext): Promise<GridPuzzle> {
  const cellsN = v.rows * v.cols;
  const pool = poolOf(ds, v.pool, cellsN);
  const k = v.answers;
  const kinds = v.kinds.length ? v.kinds : DEFAULT_KINDS;
  const cands: Cand[] = facets(ds, kinds).flatMap((f) => {
    const idx: number[] = [];
    pool.forEach((it, i) => { if (f.test(it)) idx.push(i); });
    return idx.length >= k && idx.length <= pool.length * BROAD ? [{ f, bits: new Bits(pool.length, idx) }] : [];
  });
  const found: { rows: Cand[]; cols: Cand[]; spread: number }[] = [];
  const want = v.difficulty === "normal" ? 5 : 8;
  for (let attempt = 0; attempt < 600 && found.length < want; attempt++) {
    if (attempt % 10 === 0) await ctx.yield();
    const rows: Cand[] = [];
    while (rows.length < v.rows) {
      const c = pickWeighted(rng, cands.filter((x) => !rows.includes(x) && !rows.some((r) => nested(r, x))));
      if (!c) break;
      rows.push(c);
    }
    if (rows.length < v.rows) continue;
    const cols: Cand[] = [];
    while (cols.length < v.cols) {
      const ok = cands.filter((x) => !rows.includes(x) && !cols.includes(x) && !cols.some((c) => nested(c, x))
        && rows.every((r) => { const n = r.bits.and(x.bits); return n >= k && n < Math.min(r.bits.count, x.bits.count); }));
      const c = pickWeighted(rng, ok);
      if (!c) break;
      cols.push(c);
    }
    if (cols.length < v.cols) continue;
    const answers = rows.flatMap((r) => cols.map((c) => pool.filter((it) => r.f.test(it) && c.f.test(it)).map((it) => it.id)));
    if (!assignment(answers)) continue;
    // how wide the squares are: mean log of their answer counts
    const spread = answers.reduce((s, a) => s + Math.log(a.length), 0) / answers.length;
    found.push({ rows, cols, spread });
  }
  if (!found.length) throw new Error(`no grid found where every square has ${k} or more answers among these pokémon; allow fewer answers, more kinds of rows and columns, or more pokémon`);
  found.sort((a, b) => a.spread - b.spread);
  const best = v.difficulty === "hard" ? found[0]! : v.difficulty === "easy" ? found[found.length - 1]! : found[Math.floor(found.length / 2)]!;
  return { rows: best.rows.map((c) => c.f.id), cols: best.cols.map((c) => c.f.id), pool: v.pool, guesses: cellsN + v.misses };
}

export function makeGrid(get: Dataset): PuzzleDef<GridPuzzle, GridState, GridAction, GridInteraction, ReturnType<typeof makeParams>> {
  const params = makeParams(get);
  const an = (p: GridPuzzle) => analyse(needDataset(get), p);
  return {
    id: "pokedoku",
    name: "pokémon grid",
    aliases: ["pokedoku", "immaculate grid", "pokegrid", "grid"],
    tags: ["pokémon", "trivia", "words"],
    description: "a grid whose rows and columns each ask something about a pokémon. name one pokémon for every square that fits both its row and its column, each pokémon once.",
    datasets: ["pokemon"],
    generatorVersion: 1,
    params,
    presets: [
      { label: "classic 3 × 3", params: {} },
      { label: "easy (wide squares, 3 spare guesses)", params: { difficulty: "easy", answers: 10, misses: 3 } },
      { label: "hard (narrow squares)", params: { difficulty: "hard", answers: 1 } },
      { label: "pokédex nerd (colors, shapes, egg groups)", params: { kinds: [...DEFAULT_KINDS, "color", "shape", "egg"] } },
      { label: "abilities", params: { kinds: ["type", "gen", "ability"], answers: 2 } },
      { label: "gen 1 only", params: { pool: POOL_PRESETS.find((x) => x.label === "gen 1")?.pool ?? "form:default gen:1", kinds: ["type", "typing", "evo", "class", "size", "stats", "color"] } },
      { label: "every form (megas, regional, gigantamax…)", params: { pool: "", kinds: [...DEFAULT_KINDS] } },
      { label: "4 × 4", params: { rows: 4, cols: 4 } },
    ],
    daily: { params: {} },
    generate: (v, rng, ctx) => generate(needDataset(get), v, rng, ctx),
    formats: [],
    init: (p) => ({ cells: Array.from({ length: p.rows.length * p.cols.length }, () => null), wrong: [] }),
    initInteraction: () => ({ cursor: 0 }),
    reduce: (p, s, a) => reduce(an(p), p, s, a),
    irreversible: true,
    isSolved,
    isLost: (p, s) => !isSolved(p, s) && left(p, s) <= 0,
    solve: (p, s) => {
      const board = assignment(an(p).answers, s.cells);
      return board ? { board: { ...s, cells: board } } : null;
    },
    score: (p, s) => ({ value: rarity(an(p), s), label: "rarity", better: "lower" }),
    shareText: (p, s) => {
      const a = an(p);
      const rows = p.rows.map((_, r) => p.cols.map((_, c) => (s.cells[r * p.cols.length + c] ? "🟩" : "⬜")).join(""));
      const filled = s.cells.filter(Boolean).length;
      return [`pokémon grid ${filled}/${s.cells.length}`, ...rows, `rarity ${rarity(a, s)}`].join("\n");
    },
    rules: (p) => {
      const a = an(p);
      const explained = [...a.rows, ...a.cols].filter((f) => f.detail);
      return [
        "name one pokémon for every square that fits both its row and its column. each pokémon can be used once.",
        `you have ${p.guesses} guesses${p.guesses > a.answers.length ? `, ${p.guesses - a.answers.length} more than there are squares` : ", one per square"}; a wrong guess uses one up too.`,
        "rarity: a filled square scores 100 ÷ the number of pokémon in play that fit it, an empty square 100. the total is your score: lower is rarer.",
        ...(p.pool !== DEFAULT_POOL ? [`pokémon in play: ${p.pool.trim() || "every form"} (${a.pool.length}).`] : []),
        ...explained.map((f) => `${f.label}: ${f.detail}.`),
      ];
    },
    describe: (p) => `${p.rows.length} × ${p.cols.length}`,
    describeAction: (p, act, before, after) => {
      const a = an(p);
      const name = a.byId.get(act.item)?.name ?? act.item;
      const where = `${a.rows[Math.floor(act.cell / p.cols.length)]?.label} × ${a.cols[act.cell % p.cols.length]?.label}`;
      return after.wrong.length > before.wrong.length ? `${name} doesn't fit ${where}` : `${name} for ${where}`;
    },
    rate: (p) => {
      const counts = an(p).answers.map((x) => x.length);
      return { label: `fewest answers in a square: ${Math.min(...counts)}`, score: -counts.reduce((s, n) => s + Math.log(n), 0) / counts.length };
    },
  };
}
