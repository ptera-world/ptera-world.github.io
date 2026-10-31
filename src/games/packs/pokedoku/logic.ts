import { createRng, type Rng } from "../../core/rng";
import { defineSchema, resolve, type FieldOption, type Values } from "../../core/schema";
import type { DataItem, Dataset, GenerateContext, PuzzleDef } from "../../core/types";
import { filter } from "../../lib/dataset/query";
import { askable, criteria, criterion, gridable, type Criterion } from "./criteria";

/** The datasets the game can be played on, looked up when needed (packs load in any order). */
export interface DataSource {
  get(id: string): Dataset | undefined;
  list(): readonly Dataset[];
}

export interface GridPuzzle {
  /** The dataset it is played on. Missing in puzzles saved by generator 1, which were all on pokémon (see datasetOf). */
  dataset: string;
  /** Criterion ids (./criteria) down the left and across the top. */
  rows: string[];
  cols: string[];
  /** Filter query for which items are in play: only these are offered and count as answers. */
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

/** A criterion that fits more than this share of the pool says too little to be a criterion. */
const BROAD = 0.6;

export const nounOf = (d: Dataset | undefined) => ({ one: d?.noun?.one ?? "item", many: d?.noun?.many ?? "items" });

/**
 * The dataset id a puzzle is on. Generator 1 was built on the pokémon dataset alone and stored no
 * dataset, so a saved puzzle without one is on pokémon.
 */
export const datasetOf = (p: GridPuzzle): string => p.dataset ?? "pokemon";

export function needDataset(data: DataSource, p: GridPuzzle): Dataset {
  const id = datasetOf(p);
  const d = data.get(id);
  if (!d) throw new Error(`the ${id} dataset's pack isn't loaded`);
  return d;
}

/** The attributes asked about when none are picked: the dataset's featured ones it can ask about, else every one. */
export function mainAsk(d: Dataset | undefined): string[] {
  const ids = askable(d).map((a) => a.id);
  const featured = (d?.featured ?? []).filter((id) => ids.includes(id));
  return featured.length ? featured : ids;
}

export function makeParams(data: DataSource) {
  const ds = (v: Record<string, unknown>) => data.get(String(v.dataset));
  return defineSchema({
    dataset: {
      type: "enum", label: "dataset",
      default: () => (gridable(data.get("pokemon")) ? "pokemon" : data.list().find(gridable)?.id ?? ""),
      options: () => data.list().filter(gridable).map((d) => ({ value: d.id, label: d.name })),
    },
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
    ask: {
      type: "set", label: "what rows and columns ask",
      default: (v) => mainAsk(ds(v)),
      options: (v): FieldOption[] => askable(ds(v)).map((a) => ({ value: a.id, label: a.label, ...(a.description ? { description: a.description } : {}) })),
      description: "nothing picked: the dataset's main attributes",
    },
    pool: {
      type: "string", label: "which ones are in play", default: (v) => ds(v)?.pools?.[0]?.query ?? "", placeholder: "a filter; empty: everything",
      filterOf: (v) => ds(v),
      check: (q, v) => {
        const d = ds(v);
        if (!d) return "that dataset's pack isn't loaded";
        const r = filter(d.items(), q, d.attributes);
        return "error" in r ? r.error : `${r.items.length} ${r.items.length === 1 ? nounOf(d).one : nounOf(d).many}`;
      },
    },
  });
}

export type Params = ReturnType<typeof makeParams>;
export type GridParams = Values<Params>;

/** The items a query keeps; throws a readable error for a bad query or too few. */
export function poolOf(d: Dataset, query: string, min = 1): DataItem[] {
  const r = filter(d.items(), query, d.attributes);
  if ("error" in r) throw new Error(`the filter: ${r.error}`);
  if (r.items.length < min) throw new Error(`the filter leaves ${r.items.length} ${nounOf(d).many}; this needs at least ${min}`);
  return r.items;
}

/** What a puzzle means against the dataset: the pool and each square's answers. Cached per puzzle. */
export interface Solved {
  d: Dataset;
  pool: DataItem[];
  byId: Map<string, DataItem>;
  rows: Criterion[];
  cols: Criterion[];
  /** Item ids fitting each square (row-major), in the dataset's order. */
  answers: string[][];
}

const solvedCache = new WeakMap<GridPuzzle, Solved>();

export function analyse(d: Dataset, p: GridPuzzle): Solved {
  let a = solvedCache.get(p);
  if (a && a.d === d) return a;
  const pool = poolOf(d, p.pool, 0);
  const rows = p.rows.map((id) => criterion(d, id)), cols = p.cols.map((id) => criterion(d, id));
  const answers = rows.flatMap((r) => cols.map((c) => pool.filter((it) => r.test(it) && c.test(it)).map((it) => it.id)));
  a = { d, pool, byId: new Map(pool.map((it) => [it.id, it])), rows, cols, answers };
  solvedCache.set(p, a);
  return a;
}

export const fits = (a: Solved, cell: number, item: string): boolean => a.answers[cell]!.includes(item);

export const used = (s: GridState): number => s.cells.filter((c) => c !== null).length + s.wrong.length;
export const left = (p: GridPuzzle, s: GridState): number => p.guesses - used(s);
export const isSolved = (_p: GridPuzzle, s: GridState): boolean => s.cells.every((c) => c !== null);
export const isOver = (p: GridPuzzle, s: GridState): boolean => isSolved(p, s) || left(p, s) <= 0;

/** Rarity of a square, as a percentage: 100 ÷ how many items in play fit it; an empty square is 100. */
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
 * A distinct item for every square, keeping the ones already named, or null if none exists
 * (Kuhn's augmenting paths: squares on one side, items on the other).
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
  f: Criterion;
  bits: Bits;
}

/** True if one of the two holds wherever the other does (the narrower one adds nothing). */
const nested = (a: Cand, b: Cand) => a.bits.and(b.bits) === Math.min(a.bits.count, b.bits.count);

/** A row and a column can meet: at least k fit both, and fewer than fit either. */
const crosses = (r: Cand, x: Cand, k: number) => { const n = r.bits.and(x.bits); return n >= k && n < Math.min(r.bits.count, x.bits.count); };

/** How much more often the dataset's featured attributes (the ones that best tell items apart) are asked. */
const FEATURED_WEIGHT = 3;

/**
 * An attribute, then one of its criteria. An attribute weighs the square root of how many criteria
 * it has in play (one with more to ask about comes up more, one with hundreds, like abilities,
 * doesn't crowd out the rest), times FEATURED_WEIGHT if the dataset features it.
 */
function pickWeighted(rng: Rng, cands: readonly Cand[], weight: ReadonlyMap<string, number>): Cand | null {
  if (!cands.length) return null;
  const attrs = [...new Set(cands.map((c) => c.f.attr))];
  const weights = attrs.map((k) => weight.get(k) ?? 1);
  let r = rng.next() * weights.reduce((x, y) => x + y, 0);
  let attr = attrs[attrs.length - 1]!;
  for (const [i, k] of attrs.entries()) {
    r -= weights[i]!;
    if (r < 0) { attr = k; break; }
  }
  return rng.pick(cands.filter((c) => c.f.attr === attr));
}

type Found = { rows: Cand[]; cols: Cand[]; spread: number };

/**
 * Looks for up to `want` grids by drawing rows, then columns that cross every row, keeping those
 * with a distinct answer for every square. Pauses (yields) every few attempts, so generation can
 * hand the frame back while a quick check runs it straight through.
 */
function* search(d: Dataset, v: Pick<GridParams, "rows" | "cols" | "answers" | "ask" | "pool">, want: number, rng: Rng): Generator<void, Found[], void> {
  const pool = poolOf(d, v.pool, v.rows * v.cols);
  const k = v.answers;
  const cands: Cand[] = criteria(d, v.ask.length ? v.ask : mainAsk(d)).flatMap((f) => {
    const idx: number[] = [];
    pool.forEach((it, i) => { if (f.test(it)) idx.push(i); });
    return idx.length >= k && idx.length <= pool.length * BROAD ? [{ f, bits: new Bits(pool.length, idx) }] : [];
  });
  const perAttr = new Map<string, number>();
  for (const c of cands) perAttr.set(c.f.attr, (perAttr.get(c.f.attr) ?? 0) + 1);
  const featured = new Set(d.featured ?? []);
  const weight = new Map([...perAttr].map(([a, n]) => [a, Math.sqrt(n) * (featured.has(a) ? FEATURED_WEIGHT : 1)]));
  const found: Found[] = [];
  for (let attempt = 0; attempt < 600 && found.length < want; attempt++) {
    if (attempt % 10 === 0) yield;
    const rows: Cand[] = [];
    while (rows.length < v.rows) {
      // a row no `cols` candidates cross (together with the rows so far) can't be in a grid: draw again without it
      let choice = cands.filter((x) => !rows.includes(x) && !rows.some((r) => nested(r, x)));
      let c: Cand | null = null;
      while ((c = pickWeighted(rng, choice, weight))) {
        const next = [...rows, c];
        if (cands.filter((x) => !next.includes(x) && next.every((r) => crosses(r, x, k))).length >= v.cols) break;
        choice = choice.filter((x) => x !== c);
      }
      if (!c) break;
      rows.push(c);
    }
    if (rows.length < v.rows) continue;
    const cols: Cand[] = [];
    while (cols.length < v.cols) {
      const ok = cands.filter((x) => !rows.includes(x) && !cols.includes(x) && !cols.some((c) => nested(c, x)) && rows.every((r) => crosses(r, x, k)));
      const c = pickWeighted(rng, ok, weight);
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
  return found;
}

export async function generate(d: Dataset, v: GridParams, rng: Rng, ctx: GenerateContext): Promise<GridPuzzle> {
  const noun = nounOf(d).many;
  const it = search(d, v, v.difficulty === "normal" ? 5 : 8, rng);
  let step = it.next();
  while (!step.done) {
    await ctx.yield();
    step = it.next();
  }
  const found = step.value;
  if (!found.length) throw new Error(`no grid found where every square has ${v.answers} or more answers among these ${noun}; allow fewer answers, fewer rows or columns, more kinds of rows and columns, or more ${noun}`);
  found.sort((a, b) => a.spread - b.spread);
  const best = v.difficulty === "hard" ? found[0]! : v.difficulty === "easy" ? found[found.length - 1]! : found[Math.floor(found.length / 2)]!;
  return { dataset: d.id, rows: best.rows.map((c) => c.f.id), cols: best.cols.map((c) => c.f.id), pool: v.pool, guesses: v.rows * v.cols + v.misses };
}

const fitCache = new WeakMap<Dataset, Record<string, unknown> | null>();

/**
 * The params of a dataset's preset: the largest square grid (3 × 3, else 2 × 2) it fills from its
 * default pool, asking about its main attributes or, if those can't, every attribute; null if
 * none. Worked out once per dataset.
 */
export function presetFor(d: Dataset, params: Params): Record<string, unknown> | null {
  const was = fitCache.get(d);
  if (was !== undefined) return was;
  let out: Record<string, unknown> | null = null;
  const v = resolve(params, { dataset: d.id });
  const all = askable(d).map((a) => a.id);
  find: for (const size of [3, 2]) {
    for (const ask of v.ask.join() === all.join() ? [v.ask] : [v.ask, all]) {
      try {
        const it = search(d, { ...v, ask, rows: size, cols: size }, 1, createRng(`fits ${d.id}`));
        let step = it.next();
        while (!step.done) step = it.next();
        if (step.value.length) {
          out = { dataset: d.id, ...(size !== 3 ? { rows: size, cols: size } : {}), ...(ask !== v.ask ? { ask } : {}) };
          break find;
        }
      } catch {
        // a pool too small or a filter it can't read: no grid this way
      }
    }
  }
  fitCache.set(d, out);
  return out;
}

/** On the pokémon dataset: what the grid asked before it was played on any dataset (types, generations, classes, evolution, forms, size, stats). */
const POKEMON_CLASSIC = ["type", "gen", "class", "stage", "final", "form", "height", "weight", "bst", "hp", "atk", "def", "spa", "spd", "spe"];

export function makeGrid(data: DataSource): PuzzleDef<GridPuzzle, GridState, GridAction, GridInteraction, Params> {
  const params = makeParams(data);
  const an = (p: GridPuzzle) => analyse(needDataset(data, p), p);
  const noun = (p: GridPuzzle) => nounOf(data.get(datasetOf(p)));
  return {
    id: "pokedoku",
    name: "grid",
    aliases: ["immaculate grid", "pokedoku", "pokegrid", "pokémon grid"],
    tags: ["trivia", "words"],
    description: "a grid whose rows and columns each ask something about things in a dataset (pokémon, words, chess openings…). name one for every square that fits both its row and its column, each one once.",
    datasetsOf: (p) => [datasetOf(p)],
    generatorVersion: 2,
    params,
    get presets() {
      const on = (id: string, list: { label: string; params: Record<string, unknown> }[]) => (data.get(id) && gridable(data.get(id)) ? list.map((x) => ({ label: x.label, params: { dataset: id, ...x.params } })) : []);
      return [
        ...on("pokemon", [
          { label: "classic 3 × 3", params: { ask: POKEMON_CLASSIC } },
          { label: "easy (wide squares, 3 spare guesses)", params: { ask: POKEMON_CLASSIC, difficulty: "easy", answers: 10, misses: 3 } },
          { label: "hard (narrow squares)", params: { ask: POKEMON_CLASSIC, difficulty: "hard", answers: 1 } },
          { label: "pokédex nerd (colors, shapes, egg groups)", params: { ask: [...POKEMON_CLASSIC, "color", "shape", "egg"] } },
          { label: "abilities", params: { ask: ["type", "gen", "ability"], answers: 2 } },
          { label: "gen 1 only", params: { pool: data.get("pokemon")?.pools?.find((x) => x.label === "gen 1")?.query ?? "form:default gen:1", ask: ["type", "stage", "final", "class", "height", "weight", "bst", "hp", "atk", "def", "spa", "spd", "spe", "color"] } },
          { label: "every form (megas, regional, gigantamax…)", params: { pool: "", ask: POKEMON_CLASSIC } },
          { label: "4 × 4", params: { ask: POKEMON_CLASSIC, rows: 4, cols: 4 } },
        ]),
        ...data.list().filter((d) => d.id !== "pokemon" && gridable(d)).flatMap((d) => {
          const p = presetFor(d, params);
          const n = Number(p?.rows ?? 3);
          return p ? [{ label: `${d.name}: ${n} × ${n}`, params: p }] : [];
        }),
      ];
    },
    daily: { params: {} },
    generate: (v, rng, ctx) => {
      const d = data.get(String(v.dataset));
      if (!d) throw new Error(`the ${v.dataset} dataset's pack isn't loaded`);
      return generate(d, v, rng, ctx);
    },
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
    score: (p, s) => ({ value: rarity(an(p), s), label: `rarity ${rarity(an(p), s)}`, better: "lower" }),
    shareText: (p, s) => {
      const a = an(p);
      const rows = p.rows.map((_, r) => p.cols.map((_, c) => (s.cells[r * p.cols.length + c] ? "🟩" : "⬜")).join(""));
      const filled = s.cells.filter(Boolean).length;
      return [`${a.d.name} grid ${filled}/${s.cells.length}`, ...rows, `rarity ${rarity(a, s)}`].join("\n");
    },
    rules: (p) => {
      const a = an(p);
      const n = noun(p);
      // what an attribute means, once per attribute asked about
      const explained = [...new Map([...a.rows, ...a.cols].filter((f) => f.detail).map((f) => [f.attr, `${a.d.attributes.find((x) => x.id === f.attr)?.label ?? f.attr}: ${f.detail}.`])).values()];
      const defaultPool = a.d.pools?.[0]?.query ?? "";
      const poolName = a.d.pools?.find((x) => x.query === p.pool)?.label ?? (p.pool.trim() || "everything");
      return [
        `name one ${n.one} for every square that fits both its row and its column. each ${n.one} can be used once.`,
        `you have ${p.guesses} guesses${p.guesses > a.answers.length ? `, ${p.guesses - a.answers.length} more than there are squares` : ", one per square"}; a wrong guess uses one up too.`,
        `rarity: a filled square scores 100 ÷ the number of ${n.many} in play that fit it, an empty square 100. the total is your score: lower is rarer.`,
        ...(p.pool !== defaultPool ? [`${n.many} in play: ${poolName} (${a.pool.length}).`] : []),
        ...explained,
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
