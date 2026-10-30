import type { Rng } from "../../core/rng";
import { defineSchema, type Values } from "../../core/schema";
import type { DataAttribute, DataValue, PuzzleDef } from "../../core/types";
import { compare, formatValue, parseBands, type Bands, type Feedback } from "../../lib/dataset/compare";
import { filter } from "../../lib/dataset/query";
import { DEFAULT_POOL, POOL_PRESETS, poolField } from "../../lib/pokemon/pool";
import type { PokemonDataset, PokemonItem } from "../../lib/pokemon/types";

/** What a board tells about its answer up front: attribute id → value (sets: one member it has). */
export type Given = Record<string, string | boolean>;

export interface Board {
  /** Item id of the hidden pokémon. */
  answer: string;
  /** Boards split by attribute: the values the answer has, which the player is told. */
  given?: Given;
}

export interface PokedlePuzzle {
  /** Filter query of the pokémon that can be answers. */
  pool: string;
  /** Guesses may be any pokémon, not only the pool's. */
  any: boolean;
  /** Attribute ids compared, in the order shown. */
  attrs: string[];
  /** Close bands that differ from the attributes' own. */
  bands: Record<string, { abs?: number; rel?: number } | null>;
  /** Most guesses allowed; 0: no limit. */
  limit: number;
  /** Boards open one at a time, each once the one before it is solved. */
  sequence: boolean;
  /** Attribute ids the boards are split by (one: a row of boards, two: a grid, rows by the first). */
  split: string[];
  boards: Board[];
}

export interface PokedleState {
  /** Item ids guessed, oldest first. */
  guesses: string[];
}

export type PokedleAction = { type: "guess"; id: string };

export interface PokedleInteraction {
  /** Board shown in full. */
  board: number;
}

/** Hint highlight: a board, and optionally some of its guesses (indices into state.guesses). */
export interface PokedleFocus {
  board: number;
  guesses?: number[];
}

/** The order attributes are offered and shown in; the dataset's others follow in its own order. */
const ORDER = ["type", "gen", "stage", "color", "shape", "habitat", "height", "weight", "bst", "hp", "atk", "def", "spa", "spd", "spe", "egg", "ability", "hidden", "final", "class", "form", "dex", "capture", "happiness", "growth", "gender", "eggcycles"];
export const DEFAULT_ATTRS = ["type", "gen", "stage", "color", "height", "weight"];

const comparable = (a: DataAttribute) => a.kind !== "text";
const splittable = (a: DataAttribute) => a.kind === "ordinal" || a.kind === "category" || a.kind === "set" || a.kind === "bool";

function ordered(attrs: readonly DataAttribute[]): DataAttribute[] {
  const at = (a: DataAttribute) => { const i = ORDER.indexOf(a.id); return i < 0 ? ORDER.length : i; };
  return attrs.filter(comparable).map((a, i) => ({ a, i })).sort((x, y) => at(x.a) - at(y.a) || x.i - y.i).map((x) => x.a);
}

/** The pokémon dataset, or a readable error. */
export type DataSource = () => PokemonDataset | undefined;

export function needData(data: DataSource): PokemonDataset {
  const d = data();
  if (!d) throw new Error("the pokémon data pack isn't loaded");
  return d;
}

export function makeParams(data: DataSource) {
  const attrOptions = () => ordered(data()?.attributes ?? []).map((a) => ({ value: a.id, label: a.label, ...(a.description ? { description: a.description } : {}) }));
  const splitOptions = (none: string) => [{ value: "", label: none }, ...ordered(data()?.attributes ?? []).filter(splittable).map((a) => ({ value: a.id, label: a.label }))];
  const many = (v: Record<string, unknown>) => v.split !== "" || Number(v.boards) > 1;
  return defineSchema({
    pool: poolField(data, "which pokémon can be hidden"),
    attrs: {
      type: "set", label: "what each guess is compared on", default: DEFAULT_ATTRS,
      get options() { return attrOptions(); },
    },
    guesses: { type: "int", label: "guesses (0: no limit)", default: 0, min: 0, max: 500 },
    close: {
      type: "string", label: "how near counts as close", default: "", placeholder: "e.g. weight:25%, gen:2, height:off",
      description: "attribute:amount, an amount or a percentage of the hidden pokémon's value; off: never close. empty: each attribute's usual band",
      check: (v) => {
        const d = data();
        if (!d) return "the pokémon data pack isn't loaded";
        try {
          return describeBands(parseBands(v, d.attributes), d.attributes) || "each attribute's usual band";
        } catch (e) {
          return e instanceof Error ? e.message : String(e);
        }
      },
    },
    split: {
      type: "enum", label: "one board per", default: "",
      get options() { return splitOptions("nothing: boards as below"); },
    },
    split2: {
      type: "enum", label: "and per", default: "", when: (v) => v.split !== "",
      get options() { return splitOptions("nothing (a row of boards)"); },
    },
    boards: { type: "int", label: "boards", default: 1, min: 1, max: 32, when: (v) => v.split === "" },
    sequence: {
      type: "enum", label: "boards open", default: "together", when: many,
      options: [{ value: "together", label: "all at once" }, { value: "sequence", label: "one at a time, each after the one before is solved" }],
    },
    any: { type: "bool", label: "guesses can be any pokémon", default: false, description: "otherwise only the pokémon that can be hidden can be guessed" },
  });
}

export type Params = ReturnType<typeof makeParams>;

function describeBands(b: Bands, attrs: readonly DataAttribute[]): string {
  return Object.entries(b).map(([id, band]) => {
    const a = attrs.find((x) => x.id === id);
    const name = a?.label ?? id;
    if (!band) return `${name} never close`;
    if (band.rel !== undefined) return `${name} within ${Math.round(band.rel * 100)}%`;
    return `${name} within ${band.abs}${a?.kind === "number" && a.unit ? ` ${a.unit}` : ""}`;
  }).join(", ");
}

// --- what the player sees, derived from the puzzle and the guesses ---

/** Everything a puzzle needs from the dataset, built once per puzzle object. */
export interface Ctx {
  data: PokemonDataset;
  byId: ReadonlyMap<string, PokemonItem>;
  attrs: readonly DataAttribute[];
  pool: readonly PokemonItem[];
  /** What can be guessed. */
  guessable: readonly PokemonItem[];
  guessableIds: ReadonlySet<string>;
}

const ctxCache = new WeakMap<object, Ctx>();
const indexCache = new WeakMap<PokemonDataset, Map<string, PokemonItem>>();

export function ctxOf(data: DataSource, p: PokedlePuzzle): Ctx {
  let c = ctxCache.get(p);
  if (c) return c;
  const d = needData(data);
  let byId = indexCache.get(d);
  if (!byId) indexCache.set(d, byId = new Map(d.items().map((i) => [i.id, i])));
  const attrs = p.attrs.map((id) => d.attributes.find((a) => a.id === id)).filter((a): a is DataAttribute => !!a);
  const r = filter(d.items(), p.pool, d.attributes);
  const pool = "error" in r ? [] : r.items;
  // answers are always guessable, even if the data has changed under a saved game
  const guessable = p.any ? d.items() : [...pool, ...p.boards.map((b) => byId!.get(b.answer)).filter((i): i is PokemonItem => !!i && !pool.includes(i))];
  c = { data: d, byId, attrs, pool, guessable, guessableIds: new Set(guessable.map((i) => i.id)) };
  ctxCache.set(p, c);
  return c;
}

/** True if `item` has every value the board gives. */
export function fitsGiven(item: PokemonItem, given: Given | undefined): boolean {
  if (!given) return true;
  return Object.entries(given).every(([k, v]) => {
    const x = item.values[k] ?? null;
    if (Array.isArray(x)) return x.includes(v as string);
    if (typeof v === "boolean") return x === v;
    return x !== null && String(x) === v;
  });
}

/** Index in `guesses` of the guess that found board `b`, or -1. */
export function solvedAt(p: PokedlePuzzle, s: PokedleState, b: number): number {
  return s.guesses.indexOf(p.boards[b]!.answer);
}

export const isSolved = (p: PokedlePuzzle, s: PokedleState): boolean => p.boards.every((_, b) => solvedAt(p, s, b) >= 0);
export const outOfGuesses = (p: PokedlePuzzle, s: PokedleState): boolean => p.limit > 0 && s.guesses.length >= p.limit;
export const isOver = (p: PokedlePuzzle, s: PokedleState): boolean => isSolved(p, s) || outOfGuesses(p, s);

/** Boards whose marks the player can see: all, or in sequence up to the first unsolved one. */
export function isOpen(p: PokedlePuzzle, s: PokedleState, b: number): boolean {
  if (!p.sequence) return true;
  for (let k = 0; k < b; k++) if (solvedAt(p, s, k) < 0) return false;
  return true;
}

/** How many guesses a board shows marks for: up to and including the one that found it. */
export function rowsOn(p: PokedlePuzzle, s: PokedleState, b: number): number {
  const at = solvedAt(p, s, b);
  return at < 0 ? s.guesses.length : at + 1;
}

export interface Mark {
  /** The guess is the hidden pokémon. */
  found: boolean;
  /** Per shown attribute. */
  attrs: Feedback[];
}

const markCache = new WeakMap<Ctx, Map<string, Mark>>();

/** How a guess is marked against an answer. */
export function markOf(c: Ctx, p: PokedlePuzzle, guess: string, answer: string): Mark {
  let m = markCache.get(c);
  if (!m) markCache.set(c, m = new Map());
  const key = `${guess}>${answer}`;
  let hit = m.get(key);
  if (hit) return hit;
  const g = c.byId.get(guess), a = c.byId.get(answer);
  hit = {
    found: guess === answer,
    attrs: c.attrs.map((attr) => compare(attr, g?.values[attr.id] ?? null, a?.values[attr.id] ?? null, p.bands)),
  };
  m.set(key, hit);
  return hit;
}

function sameFeedback(attr: DataAttribute, x: Feedback, y: Feedback): boolean {
  if (x.verdict !== y.verdict || x.dir !== y.dir) return false;
  return attr.kind !== "set" || (x.shared ?? []).join() === (y.shared ?? []).join();
}

/** True if `cand` as the answer would have marked `guess` exactly as `answer` did. */
function fits(c: Ctx, p: PokedlePuzzle, guess: string, answer: string, cand: string): boolean {
  if (cand === guess) return guess === answer;
  if (guess === answer) return false;
  const want = markOf(c, p, guess, answer), got = markOf(c, p, guess, cand);
  return c.attrs.every((a, i) => sameFeedback(a, want.attrs[i]!, got.attrs[i]!));
}

const candCache = new WeakMap<object, Map<string, PokemonItem[]>>();

/**
 * The pokémon that could still be board `b`'s answer from what the player has seen: in the pool,
 * with the board's given values, marked like every guess so far, and not the answer of another
 * board already found (every board hides a different pokémon).
 */
export function candidates(data: DataSource, p: PokedlePuzzle, s: PokedleState, b: number): PokemonItem[] {
  const c = ctxOf(data, p);
  const board = p.boards[b]!;
  let cache = candCache.get(p);
  if (!cache) candCache.set(p, cache = new Map());
  const n = rowsOn(p, s, b);
  const keyAt = (k: number) => `${b}|${s.guesses.slice(0, k).join(",")}`;
  let k = n;
  while (k > 0 && !cache.has(keyAt(k))) k--;
  let list = cache.get(keyAt(k)) ?? c.pool.filter((i) => fitsGiven(i, board.given));
  if (k === 0) cache.set(keyAt(0), list);
  for (; k < n; k++) {
    const g = s.guesses[k]!;
    // only boards the player has seen found (in sequence, a later board found early is still closed)
    const seen: PokedleState = { guesses: s.guesses.slice(0, k + 1) };
    const found = new Set(p.boards.flatMap((o, ob) => (ob !== b && solvedAt(p, seen, ob) >= 0 && isOpen(p, seen, ob) ? [o.answer] : [])));
    list = list.filter((it) => fits(c, p, g, board.answer, it.id) && !found.has(it.id));
    cache.set(keyAt(k + 1), list);
  }
  return list;
}

/** For each shown attribute, the first guess (index) marked right on board `b`, or -1. */
export function firstRight(data: DataSource, p: PokedlePuzzle, s: PokedleState, b: number): number[] {
  const c = ctxOf(data, p);
  const n = rowsOn(p, s, b);
  return c.attrs.map((_, i) => {
    for (let k = 0; k < n; k++) if (markOf(c, p, s.guesses[k]!, p.boards[b]!.answer).attrs[i]!.verdict === "match") return k;
    return -1;
  });
}

/** Best mark so far per attribute on a board: what the board's tile shows. */
export function bestSoFar(data: DataSource, p: PokedlePuzzle, s: PokedleState, b: number): ("match" | "near" | "miss" | "none")[] {
  const c = ctxOf(data, p);
  const n = rowsOn(p, s, b);
  return c.attrs.map((_, i) => {
    let best: "match" | "near" | "miss" | "none" = "none";
    for (let k = 0; k < n; k++) {
      const v = markOf(c, p, s.guesses[k]!, p.boards[b]!.answer).attrs[i]!.verdict;
      if (v === "match") return "match";
      if (v === "close" || v === "partial") best = "near";
      else if (best === "none") best = "miss";
    }
    return best;
  });
}

// --- the game ---

export function reduce(data: DataSource, p: PokedlePuzzle, s: PokedleState, a: PokedleAction): PokedleState {
  if (a.type !== "guess" || isOver(p, s) || s.guesses.includes(a.id)) return s;
  if (!ctxOf(data, p).guessableIds.has(a.id)) return s;
  return { guesses: [...s.guesses, a.id] };
}

/** Values of an attribute boards can be split by, in its order. */
function splitValues(a: DataAttribute): (string | boolean)[] {
  return a.kind === "bool" ? [true, false] : (a.values ?? []).map((v) => v.value);
}

export function generate(data: DataSource, v: Values<Params>, rng: Rng): PokedlePuzzle {
  const d = needData(data);
  const r = filter(d.items(), v.pool, d.attributes);
  if ("error" in r) throw new Error(`the pokémon filter: ${r.error}`);
  const pool = r.items;
  if (!v.attrs.length) throw new Error("pick at least one thing to compare guesses on");
  const bands = parseBands(v.close, d.attributes);
  const split = [v.split, v.split2].filter((x, i, all) => x !== "" && all.indexOf(x) === i);
  const attr = (id: string) => d.attributes.find((a) => a.id === id)!;
  let boards: Board[];
  if (!split.length) {
    if (pool.length < v.boards) throw new Error(`the pokémon filter leaves ${pool.length} pokémon, fewer than ${v.boards} boards`);
    boards = rng.shuffle(pool.slice()).slice(0, v.boards).map((i) => ({ answer: i.id }));
  } else {
    // every combination of the split values that some pokémon in the pool has
    let cells: Given[] = [{}];
    for (const id of split) cells = cells.flatMap((g) => splitValues(attr(id)).map((x) => ({ ...g, [id]: x })));
    const options = cells.map((given) => ({ given, cands: pool.filter((i) => fitsGiven(i, given)) })).filter((c) => c.cands.length);
    // fewest candidates first, so a cell with few pokémon isn't left with none by its neighbours
    const order = options.map((_, i) => i).sort((x, y) => options[x]!.cands.length - options[y]!.cands.length || x - y);
    const used = new Set<string>();
    const answer = new Map<number, string>();
    for (const i of order) {
      const free = options[i]!.cands.filter((c) => !used.has(c.id));
      if (!free.length) continue;
      const pick = rng.pick(free).id;
      used.add(pick);
      answer.set(i, pick);
    }
    boards = options.flatMap((o, i) => (answer.has(i) ? [{ answer: answer.get(i)!, given: o.given }] : []));
    if (!boards.length) throw new Error("no pokémon in the filter has any of those values");
  }
  if (v.guesses > 0 && v.guesses < boards.length) throw new Error(`${boards.length} boards need at least ${boards.length} guesses`);
  return {
    pool: v.pool, any: v.any, attrs: [...v.attrs], bands, limit: v.guesses,
    sequence: v.sequence === "sequence" && boards.length > 1, split, boards,
  };
}

/** A board's given values in words ("fire", "gen 1 · fire"). */
export function givenLabel(d: PokemonDataset, given: Given | undefined): string {
  if (!given) return "";
  return Object.entries(given).map(([k, x]) => {
    const a = d.attributes.find((q) => q.id === k);
    if (!a) return String(x);
    if (a.kind === "bool") return `${x ? "" : "not "}${a.label}`;
    return formatValue(a, a.kind === "set" ? [x as string] : (x as DataValue));
  }).join(" · ");
}

const keycap = (n: number) => String(n).split("").map((ch) => `${ch}⃣`).join("");

export function shareText(data: DataSource, p: PokedlePuzzle, s: PokedleState): string {
  const c = ctxOf(data, p);
  const used = s.guesses.length;
  const head = `pokédle ${isSolved(p, s) ? used : "X"}/${p.limit || "∞"}`;
  if (p.boards.length === 1) {
    const sq = { match: "🟩", close: "🟨", partial: "🟨", miss: "⬛" } as const;
    const rows = s.guesses.slice(0, rowsOn(p, s, 0)).map((g) => c.attrs.map((_, i) => sq[markOf(c, p, g, p.boards[0]!.answer).attrs[i]!.verdict]).join(""));
    return [head, ...rows].join("\n");
  }
  const cell = (b: number) => { const at = solvedAt(p, s, b); return at < 0 ? "🟥" : keycap(at + 1); };
  const width = p.split.length === 2 ? new Set(p.boards.map((b) => String(b.given?.[p.split[1]!]))).size : Math.min(4, Math.ceil(Math.sqrt(p.boards.length)));
  const lines: string[] = [];
  for (let i = 0; i < p.boards.length; i += width) lines.push(p.boards.slice(i, i + width).map((_, k) => cell(i + k)).join(" "));
  return [head, ...lines].join("\n");
}

export function pokedleDef(data: DataSource): PuzzleDef<PokedlePuzzle, PokedleState, PokedleAction, PokedleInteraction, Params> {
  const params = makeParams(data);
  const name = (p: PokedlePuzzle, id: string) => ctxOf(data, p).byId.get(id)?.name ?? id;
  return {
    id: "pokedle",
    name: "pokédle",
    aliases: ["pokedle", "squirdle", "pokémon wordle", "who's that pokémon", "quordle", "loldle"],
    tags: ["deduction", "words", "pokémon"],
    description: "guess the hidden pokémon. every guess shows, for each thing it's compared on, whether it's right, close (and which way), shares some (types, abilities), or wrong.",
    datasets: ["pokemon"],
    generatorVersion: 1,
    params,
    presets: [
      { label: "classic", params: {} },
      { label: "gen 1, 6 guesses", params: { pool: "form:default gen:1", guesses: 6 } },
      { label: "generation, type, height and weight; 8 guesses", params: { attrs: ["type", "gen", "height", "weight"], guesses: 8 } },
      { label: "gens 1–3 with habitat", params: { pool: "form:default gen:1-3", attrs: ["type", "gen", "stage", "color", "habitat", "height", "weight"] } },
      { label: "base stats", params: { attrs: ["type", "hp", "atk", "def", "spa", "spd", "spe"] } },
      { label: "4 boards, 9 guesses", params: { boards: 4, guesses: 9 } },
      { label: "8 boards, 13 guesses", params: { boards: 8, guesses: 13 } },
      { label: "16 boards, 21 guesses", params: { boards: 16, guesses: 21 } },
      { label: "4 boards one at a time, 10 guesses", params: { boards: 4, guesses: 10, sequence: "sequence" } },
      { label: "one per type", params: { split: "type" } },
      { label: "one per generation", params: { split: "gen" } },
      { label: "generation × type, gens 1–3", params: { pool: "form:default gen:1-3", split: "gen", split2: "type" } },
      ...POOL_PRESETS.filter((x) => x.pool !== DEFAULT_POOL).map((x) => ({ label: `classic, ${x.label}`, params: { pool: x.pool } })),
    ],
    daily: { params: {} },
    // a guess, once marked, has told you what it told you: taking it back would only refund the guess
    irreversible: true,
    generate: (v, rng) => generate(data, v, rng),
    formats: [],
    init: () => ({ guesses: [] }),
    initInteraction: () => ({ board: 0 }),
    reduce: (p, s, a) => reduce(data, p, s, a),
    isSolved,
    isLost: (p, s) => !isSolved(p, s) && outOfGuesses(p, s),
    solve: (p, s) => {
      const left = p.boards.filter((_, b) => solvedAt(p, s, b) < 0).map((b) => b.answer);
      if (p.limit > 0 && s.guesses.length + left.length > p.limit) return null;
      return { moves: left.map((id) => ({ type: "guess" as const, id })) };
    },
    describeAction: (p, a) => `guess ${name(p, a.id)}`,
    describe: (p) => {
      const n = p.boards.length;
      const parts = [n === 1 ? "1 pokémon" : `${n} boards${p.sequence ? " in sequence" : ""}`, p.limit ? `${p.limit} guesses` : "no guess limit"];
      return parts.join(", ");
    },
    rules: (p) => {
      const c = ctxOf(data, p);
      const many = p.boards.length > 1;
      return [
        many ? `${p.boards.length} pokémon are hidden, a different one on each board.` : "a pokémon is hidden.",
        ...(p.split.length ? [`each board says what its pokémon's ${p.split.map((id) => c.attrs.find((a) => a.id === id)?.label ?? c.data.attributes.find((a) => a.id === id)?.label ?? id).join(" and ")} is.`] : []),
        `type a pokémon's name to guess it${many ? (p.sequence ? "; each guess counts for every open board, and the next board opens (with your earlier guesses on it) once one is found" : "; each guess counts for every board") : ""}.`,
        `each guess is compared on ${c.attrs.map((a) => a.label).join(", ")}: green is right, yellow is close (numbers) or shares some but not all (lists such as types), grey is wrong. an arrow says whether the hidden pokémon's value is higher or lower.`,
        "in a list, the members the hidden pokémon also has are shown plainly; the others are struck out.",
        p.limit ? `you have ${p.limit} guesses${many ? " for all the boards together" : ""}.` : "there is no guess limit.",
      ];
    },
    score: (p, s) => (isSolved(p, s) ? { value: s.guesses.length, label: s.guesses.length === 1 ? "1 guess" : `${s.guesses.length} guesses`, better: "lower" } : null),
    shareText: (p, s) => shareText(data, p, s),
    rate: (p) => {
      const n = ctxOf(data, p).pool.length;
      return { label: `${n} pokémon${p.boards.length > 1 ? `, ${p.boards.length} boards` : ""}`, score: Math.log2(Math.max(2, n)) * p.boards.length / Math.max(1, p.attrs.length) };
    },
  };
}
