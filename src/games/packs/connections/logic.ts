import type { Rng } from "../../core/rng";
import { defineSchema, type FieldOption, type Values } from "../../core/schema";
import type { DataItem, Dataset, GenerateContext, PuzzleDef } from "../../core/types";
import { filter } from "../../lib/dataset/query";
import { kindsOf, linkOf, links, type Link } from "./links";

export interface Group {
  /** Link id (see links.ts). */
  link: string;
  items: string[];
  /** 0 easiest (yellow) up. */
  tier: number;
}

export interface ConnPuzzle {
  /** The dataset the board is drawn from. */
  dataset: string;
  /** Every item on the board, in the order first shown. */
  items: string[];
  /** Easiest first. */
  groups: Group[];
  /** Wrong guesses that end the game. */
  mistakes: number;
  /** Link kinds the generator checked uniqueness against: the links that could be in play. */
  kinds: string[];
  /** Filter query for the items in play (links every one of them shares are no links). */
  pool: string;
}

export interface ConnState {
  /** Every group handed in, in order (each sorted as the board lists them). */
  guesses: string[][];
}

export type ConnAction = { type: "guess"; items: string[] };

export interface ConnInteraction {
  selected: string[];
  /** The board's current order after shuffling; null: the puzzle's own. */
  order: string[] | null;
  cursor: number;
}

/** The datasets the game can be played on, looked up when needed (packs load in any order). */
export interface DataSource {
  get(id: string): Dataset | undefined;
  list(): readonly Dataset[];
}

export function needDataset(data: DataSource, id: string): Dataset {
  const d = data.get(id);
  if (!d) throw new Error(`the ${id} dataset's pack isn't loaded`);
  return d;
}

/** A link fitting more than this share of the pool sets its members apart from too few others to be a link. */
const EVERYONE = 0.5;

/**
 * Kinds offered unless the player picks others: those whose links each fit at most this share of
 * the pool on average, so on a board of 4×4 a group's link fits about 1.5 of the other 12 by
 * chance. Broader kinds (on pokémon: evolution stage, one or two types) split the board too evenly
 * to make good groups, so they are opt-in; so are numbers, whose thresholds are cut from the data.
 */
const NARROW = 1 / 8;

/** The items a filter leaves; throws a readable error for a bad query or too few. */
export function poolOf(d: Dataset, query: string, min = 1): DataItem[] {
  const r = filter(d.items(), query, d.attributes);
  if ("error" in r) throw new Error(`the filter: ${r.error}`);
  const many = d.noun?.many ?? "items";
  if (r.items.length < min) throw new Error(`the filter leaves ${r.items.length} ${many}; this needs at least ${min}`);
  return r.items;
}

const defaultPool = (d: Dataset): string => d.pools?.[0]?.query ?? "";

const narrowKinds = new WeakMap<Dataset, string[]>();

/** The kinds a dataset plays with unless told otherwise (see NARROW), judged over its default pool. */
export function defaultKinds(d: Dataset | undefined): string[] {
  if (!d) return [];
  let out = narrowKinds.get(d);
  if (out) return out;
  const r = filter(d.items(), defaultPool(d), d.attributes);
  const pool = "error" in r ? [] : r.items;
  out = kindsOf(d).filter((k) => d.attributes.find((a) => a.id === k.value)?.kind !== "number").map((k) => k.value).filter((k) => {
    const shares = links(d, [k]).map((l) => pool.filter(l.test).length / pool.length).filter((s) => s * pool.length >= 3 && s <= EVERYONE);
    return shares.length > 0 && shares.reduce((a, b) => a + b, 0) / shares.length <= NARROW;
  });
  narrowKinds.set(d, out);
  return out;
}

/** The fewest groups and the smallest group a board can have. */
const MIN_GROUPS = 3, MIN_SIZE = 3;

/** True if a smallest board could be drawn from the dataset's default pool with its default kinds. */
export function playable(d: Dataset): boolean {
  let ok = playables.get(d);
  if (ok !== undefined) return ok;
  const kinds = defaultKinds(d);
  const r = filter(d.items(), defaultPool(d), d.attributes);
  ok = kinds.length > 0 && !("error" in r) && linkFacets(d, kinds, r.items).filter((l) => r.items.filter(l.test).length >= MIN_SIZE).length >= MIN_GROUPS;
  playables.set(d, ok);
  return ok;
}
const playables = new WeakMap<Dataset, boolean>();

/** Attributes no two items on a board may share a value of (e.g. a species' number, so no two tiles are forms of one species). */
const apartable = (d: Dataset | undefined) => (d?.attributes ?? []).filter((a) => a.kind === "number" || a.kind === "ordinal" || a.kind === "category");

export function makeParams(data: DataSource) {
  const ds = (v: Record<string, unknown>) => data.get(String(v.dataset));
  const noun = (v: Record<string, unknown>) => ds(v)?.noun?.many ?? "items";
  return defineSchema({
    dataset: {
      type: "enum", label: "dataset",
      default: () => { const ok = data.list().filter(playable); return (ok.find((d) => d.id === "pokemon") ?? ok[0])?.id ?? ""; },
      options: () => data.list().filter(playable).map((d) => ({ value: d.id, label: d.name })),
    },
    groups: { type: "int", label: "groups", default: 4, min: MIN_GROUPS, max: 6 },
    size: { type: "int", label: "per group", default: 4, min: MIN_SIZE, max: 5 },
    mistakes: { type: "int", label: "mistakes allowed", default: 4, min: 1, max: 10 },
    difficulty: {
      type: "enum", label: "red herrings", default: "normal",
      description: "ones that also fit another group's link",
      options: [{ value: "easy", label: "few" }, { value: "normal", label: "some" }, { value: "hard", label: "many" }],
    },
    kinds: {
      type: "set", label: "links in play",
      default: (v) => defaultKinds(ds(v)),
      options: (v): FieldOption[] => kindsOf(ds(v)),
    },
    pool: {
      type: "string", label: "which ones", default: (v) => { const d = ds(v); return d ? defaultPool(d) : ""; }, placeholder: "a filter; empty: everything",
      filterOf: (v) => ds(v),
      check: (q, v) => {
        const d = ds(v);
        if (!d) return "that dataset's pack isn't loaded";
        const r = filter(d.items(), q, d.attributes);
        return "error" in r ? r.error : `${r.items.length} ${noun(v)}`;
      },
    },
    apart: {
      type: "enum", label: "no two share", default: "",
      description: "no two on the board have the same value of this (e.g. pokémon: dex number, so no two are forms of one species)",
      options: (v): FieldOption[] => [{ value: "", label: "nothing" }, ...apartable(ds(v)).map((a) => ({ value: a.id, label: a.label }))],
    },
  });
}

export type Params = ReturnType<typeof makeParams>;
export type ConnParams = Values<Params>;

const key = (ids: readonly string[]) => [...ids].sort().join(" ");

export const groupOf = (p: ConnPuzzle, ids: readonly string[]): number => {
  const k = key(ids);
  return p.groups.findIndex((g) => key(g.items) === k);
};

/** Groups found, in the order found. */
export const found = (p: ConnPuzzle, s: ConnState): number[] => s.guesses.map((g) => groupOf(p, g)).filter((g) => g >= 0);
export const mistakesMade = (p: ConnPuzzle, s: ConnState): number => s.guesses.filter((g) => groupOf(p, g) < 0).length;
export const isSolved = (p: ConnPuzzle, s: ConnState): boolean => found(p, s).length === p.groups.length;
export const isLost = (p: ConnPuzzle, s: ConnState): boolean => !isSolved(p, s) && mistakesMade(p, s) >= p.mistakes;
export const isOver = (p: ConnPuzzle, s: ConnState): boolean => isSolved(p, s) || isLost(p, s);
export const groupSize = (p: ConnPuzzle): number => p.groups[0]!.items.length;

/** The last guess was wrong by one: all but one of it belong to one group still on the board. */
export function oneAway(p: ConnPuzzle, s: ConnState): boolean {
  const last = s.guesses[s.guesses.length - 1];
  if (!last || groupOf(p, last) >= 0) return false;
  return p.groups.some((g) => last.filter((id) => g.items.includes(id)).length === last.length - 1);
}

export const alreadyGuessed = (s: ConnState, ids: readonly string[]): boolean => s.guesses.some((g) => key(g) === key(ids));

export function reduce(p: ConnPuzzle, s: ConnState, a: ConnAction): ConnState {
  if (a.type !== "guess" || isOver(p, s) || !Array.isArray(a.items)) return s;
  const ids = a.items;
  const done = new Set(found(p, s).flatMap((g) => p.groups[g]!.items));
  if (ids.length !== groupSize(p) || new Set(ids).size !== ids.length || ids.some((id) => !p.items.includes(id) || done.has(id)) || alreadyGuessed(s, ids)) return s;
  const ordered = p.items.filter((id) => ids.includes(id));
  return { guesses: [...s.guesses, ordered] };
}

// --- uniqueness ---

/** Every `k`-subset of `idx`, as bit masks. */
function subsets(idx: readonly number[], k: number, out: Set<number>): void {
  const walk = (from: number, left: number, mask: number) => {
    if (left === 0) { out.add(mask); return; }
    for (let i = from; i <= idx.length - left; i++) walk(i + 1, left - 1, mask | (1 << idx[i]!));
  };
  walk(0, k, 0);
}

/**
 * Ways (stopping at `limit`) to split items 0…n-1 into groups of `k` that each share one of the
 * links: `members[f]` lists the items link f holds for.
 */
export function countPartitions(n: number, k: number, members: readonly (readonly number[])[], limit = 2): number {
  const valid = new Set<number>();
  for (const m of members) if (m.length >= k) subsets(m, k, valid);
  const byLowest: number[][] = Array.from({ length: n }, () => []);
  for (const mask of valid) byLowest[31 - Math.clz32(mask & -mask)]!.push(mask);
  const all = n === 31 ? 0x7fffffff : (1 << n) - 1;
  let count = 0;
  const walk = (covered: number) => {
    if (covered === all) { count++; return; }
    const free = ~covered & all;
    const low = 31 - Math.clz32(free & -free);
    for (const mask of byLowest[low]!) {
      if (mask & covered) continue;
      walk(covered | mask);
      if (count >= limit) return;
    }
  };
  walk(0);
  return count;
}

/** Links of the kinds in play that hold for at least `k` of `items`, with which. */
function linksAmong(all: readonly Link[], items: readonly DataItem[], k: number): { f: Link; members: number[] }[] {
  const out: { f: Link; members: number[] }[] = [];
  for (const f of all) {
    const members: number[] = [];
    items.forEach((it, i) => { if (f.test(it)) members.push(i); });
    if (members.length >= k) out.push({ f, members });
  }
  return out;
}

/** Links of `kinds` that can be links among `pool`: all but those most of the pool shares (see EVERYONE). */
export function linkFacets(d: Dataset, kinds: readonly string[], pool: readonly DataItem[]): Link[] {
  return links(d, kinds).filter((f) => pool.filter(f.test).length <= pool.length * EVERYONE);
}

/** True if splitting `items` into groups of `k` sharing one of `links` can be done exactly one way. */
export function unique(all: readonly Link[], items: readonly DataItem[], k: number): boolean {
  return countPartitions(items.length, k, linksAmong(all, items, k).map((l) => l.members)) === 1;
}

// --- generation ---

/** Where a link's kind sits among the dataset's featured attributes (the ones that best tell items apart), or -1. */
function featuredAt(d: Dataset, kind: string): number {
  return (d.featured ?? []).indexOf(kind);
}

/** How often each kind is drawn as a link, relative to the others: the dataset's featured attributes twice as often. */
const kindWeight = (d: Dataset, kind: string): number => (featuredAt(d, kind) >= 0 ? 2 : 1);

/**
 * How hard a link is to see, before red herrings: a featured attribute (what the dataset says best
 * tells its items apart, so what players know first) easier the earlier it is listed, any other
 * attribute after them. Used only to order the groups into tiers.
 */
function kindDifficulty(d: Dataset, kind: string): number {
  const at = featuredAt(d, kind);
  const n = d.featured?.length ?? 0;
  return at >= 0 ? (2 * at) / n : 2.5;
}

function pickKindWeighted<T extends { f: Link }>(d: Dataset, rng: Rng, cands: readonly T[]): T | null {
  if (!cands.length) return null;
  const kinds = [...new Set(cands.map((c) => c.f.kind))];
  const w = kinds.map((k) => kindWeight(d, k));
  let r = rng.next() * w.reduce((a, b) => a + b, 0);
  let kind = kinds[kinds.length - 1]!;
  for (const [i, k] of kinds.entries()) {
    r -= w[i]!;
    if (r < 0) { kind = k; break; }
  }
  return rng.pick(cands.filter((c) => c.f.kind === kind));
}

/** Herring share per difficulty: how often a pick is one that also fits another group's link. */
const HERRING_P: Record<string, number> = { easy: 0.05, normal: 0.3, hard: 0.6 };

/** Groups on one board drawn from the same kind, at most. */
const PER_KIND = 2;

export async function generate(d: Dataset, v: ConnParams, rng: Rng, ctx: GenerateContext): Promise<ConnPuzzle> {
  const n = v.groups * v.size;
  const many = d.noun?.many ?? "items";
  const kinds = v.kinds.length ? [...v.kinds] : defaultKinds(d);
  const pool = poolOf(d, v.pool, n);
  const all = linkFacets(d, kinds, pool);
  const apart = v.apart ? d.attributes.find((a) => a.id === v.apart && a.kind !== "set" && a.kind !== "text") : undefined;
  /** What two items on one board may not share (null: nothing to share). */
  const apartKey = (it: DataItem): string | null => {
    if (!apart) return null;
    const x = it.values[apart.id];
    return x === null || x === undefined ? null : String(x);
  };
  const cands = all.flatMap((f) => {
    const idx: number[] = [];
    pool.forEach((it, i) => { if (f.test(it)) idx.push(i); });
    return idx.length >= v.size ? [{ f, idx }] : [];
  });
  if (cands.length < v.groups) throw new Error(`only ${cands.length} links fit ${v.size} or more of these ${many}; allow more kinds of links or more ${many}`);
  const pH = HERRING_P[v.difficulty] ?? 0.3;
  const boards: { groups: { f: Link; items: DataItem[] }[]; herrings: number }[] = [];
  const want = v.difficulty === "normal" ? 5 : 8;
  for (let attempt = 0; attempt < 4000 && boards.length < want; attempt++) {
    if (attempt % 8 === 0) await ctx.yield();
    const chosen: typeof cands = [];
    while (chosen.length < v.groups) {
      const c = pickKindWeighted(d, rng, cands.filter((x) => !chosen.includes(x) && chosen.filter((y) => y.f.kind === x.f.kind).length < PER_KIND));
      if (!c) break;
      chosen.push(c);
    }
    if (chosen.length < v.groups) continue;
    // tiles are told apart by name (some datasets name several items alike, e.g. one opening reached by two move orders)
    const taken = new Set<string>(), names = new Set<string>();
    const clashes = (it: DataItem, picks: readonly DataItem[]) => {
      if (names.has(it.name) || picks.some((x) => x.name === it.name)) return true;
      const k = apartKey(it);
      return k !== null && (taken.has(k) || picks.some((x) => apartKey(x) === k));
    };
    const onBoard = new Set<DataItem>();
    const groups: { f: Link; items: DataItem[] }[] = [];
    for (const c of rng.shuffle(chosen.slice())) {
      const others = chosen.filter((x) => x !== c);
      const free = c.idx.map((i) => pool[i]!).filter((it) => !onBoard.has(it));
      const herring = free.filter((it) => others.some((o) => o.f.test(it)));
      const plain = free.filter((it) => !others.some((o) => o.f.test(it)));
      const picks: DataItem[] = [];
      while (picks.length < v.size) {
        const fromH = herring.filter((it) => !picks.includes(it) && !clashes(it, picks));
        const fromP = plain.filter((it) => !picks.includes(it) && !clashes(it, picks));
        const src = (rng.next() < pH && fromH.length) || !fromP.length ? fromH : fromP;
        if (!src.length) break;
        picks.push(rng.pick(src));
      }
      if (picks.length < v.size) break;
      for (const it of picks) { onBoard.add(it); names.add(it.name); const k = apartKey(it); if (k !== null) taken.add(k); }
      groups.push({ f: c.f, items: picks });
    }
    if (groups.length < v.groups) continue;
    const items = groups.flatMap((g) => g.items);
    const ls = linksAmong(all, items, v.size);
    if (countPartitions(items.length, v.size, ls.map((l) => l.members)) !== 1) continue;
    // red herrings: items outside a group that fit its link, and links of no group that still fit enough of the board
    let herrings = 0;
    for (const g of groups) herrings += items.filter((it) => !g.items.includes(it) && g.f.test(it)).length;
    herrings += 0.5 * ls.filter((l) => !groups.some((g) => g.f.id === l.f.id)).length;
    boards.push({ groups, herrings });
  }
  if (!boards.length) throw new Error(`no board found where the groups can only be split one way; allow more kinds of links, more ${many}, or smaller groups`);
  boards.sort((a, b) => a.herrings - b.herrings);
  const best = v.difficulty === "easy" ? boards[0]! : v.difficulty === "hard" ? boards[boards.length - 1]! : boards[Math.floor(boards.length / 2)]!;
  const items = best.groups.flatMap((g) => g.items);
  const scored = best.groups.map((g) => ({
    g,
    d: kindDifficulty(d, g.f.kind) + 0.75 * items.filter((it) => !g.items.includes(it) && g.f.test(it)).length,
  })).sort((a, b) => a.d - b.d);
  return {
    dataset: d.id,
    items: rng.shuffle(items.map((it) => it.id)),
    groups: scored.map(({ g }, tier) => ({ link: g.f.id, items: g.items.map((it) => it.id), tier })),
    mistakes: v.mistakes,
    kinds,
    pool: v.pool,
  };
}

export interface Board {
  d: Dataset;
  byId: Map<string, DataItem>;
  links: Link[];
}

const boards = new WeakMap<ConnPuzzle, Board>();

export function board(d: Dataset, p: ConnPuzzle): Board {
  let b = boards.get(p);
  if (!b) {
    const all = new Map(d.items().map((it) => [it.id, it]));
    boards.set(p, b = { d, byId: new Map(p.items.flatMap((id) => (all.has(id) ? [[id, all.get(id)!] as const] : []))), links: p.groups.map((g) => linkOf(d, g.link)) });
  }
  return b;
}

export const TIER_COLORS = ["#f9df6d", "#a0c35a", "#b0c4ef", "#ba81c5", "#f0a35e", "#e98fa0"];
export const TIER_EMOJI = ["🟨", "🟩", "🟦", "🟪", "🟧", "🟥"];

/** Link kinds the pokémon presets play with: what the game offered on pokémon before it took any dataset. */
const POKEMON_KINDS = ["type", "gen", "class", "form", "color", "shape", "egg", "ability", "gender", "family"];
const POKEMON_NUMBERS = ["height", "weight", "hp", "atk", "def", "spa", "spd", "spe", "bst"];

export function makeConnections(data: DataSource): PuzzleDef<ConnPuzzle, ConnState, ConnAction, ConnInteraction, Params> {
  const params = makeParams(data);
  const ds = (p: ConnPuzzle) => needDataset(data, p.dataset);
  const bd = (p: ConnPuzzle) => board(ds(p), p);
  const name = (p: ConnPuzzle, id: string) => bd(p).byId.get(id)?.name ?? id;
  const noun = (p: ConnPuzzle) => data.get(p.dataset)?.noun?.many ?? "items";
  return {
    id: "connections",
    name: "connections",
    aliases: ["nyt connections", "groups", "only connect", "pokémon connections"],
    tags: ["trivia", "words"],
    description: "sixteen things from a dataset (pokémon, chess openings…) in four hidden groups of four that share something: a type, a generation, an opening… find every group before you run out of mistakes.",
    datasetsOf: (p) => [p.dataset],
    generatorVersion: 1,
    params,
    get presets() {
      const on = (id: string, list: { label: string; params: Record<string, unknown> }[]) => (data.get(id) ? list.map((x) => ({ label: x.label, params: { dataset: id, ...x.params } })) : []);
      return [
        ...on("pokemon", [
          { label: "pokémon: classic (4 groups of 4)", params: { kinds: POKEMON_KINDS } },
          { label: "pokémon: gentle (few red herrings)", params: { difficulty: "easy", kinds: POKEMON_KINDS } },
          { label: "pokémon: devious (many red herrings)", params: { difficulty: "hard", kinds: POKEMON_KINDS } },
          { label: "pokémon: small (3 groups of 3)", params: { groups: 3, size: 3, kinds: POKEMON_KINDS } },
          { label: "pokémon: big (5 groups of 5)", params: { groups: 5, size: 5, mistakes: 5, kinds: POKEMON_KINDS } },
          { label: "pokémon: gen 1 only", params: { pool: "form:default gen:1", kinds: ["type", "class", "color", "shape", "egg", "ability", "family", "stage", "final", "gender"] } },
          { label: "pokémon: with megas and regional forms", params: { pool: "form:default,mega,regional", kinds: POKEMON_KINDS, apart: "dex" } },
          { label: "pokémon: numbers too (weight, height, stats)", params: { kinds: [...POKEMON_KINDS, ...POKEMON_NUMBERS] } },
        ]),
        ...data.list().filter((d) => d.id !== "pokemon" && playable(d)).map((d) => ({ label: d.name, params: { dataset: d.id } })),
      ];
    },
    daily: { params: {} },
    generate: (v, rng, ctx) => generate(needDataset(data, String(v.dataset)), v, rng, ctx),
    formats: [],
    init: () => ({ guesses: [] }),
    initInteraction: (p) => ({ selected: [], order: p.items.slice(), cursor: 0 }),
    irreversible: true,
    reduce,
    isSolved,
    isLost,
    solve: (p, s) => (isLost(p, s) ? null : { moves: p.groups.filter((_, g) => !found(p, s).includes(g)).map((g): ConnAction => ({ type: "guess", items: g.items.slice() })) }),
    score: (p, s) => (isSolved(p, s) ? { value: mistakesMade(p, s), label: mistakesMade(p, s) === 1 ? "1 mistake" : `${mistakesMade(p, s)} mistakes`, better: "lower" } : null),
    shareText: (p, s) => {
      const tierOf = (id: string) => p.groups.find((g) => g.items.includes(id))!.tier;
      const rows = s.guesses.map((g) => g.map((id) => TIER_EMOJI[tierOf(id)] ?? "⬜").join(""));
      return [`connections · ${data.get(p.dataset)?.name ?? p.dataset}${isSolved(p, s) ? "" : " (not solved)"}`, ...rows].join("\n");
    },
    rules: (p) => {
      const k = groupSize(p);
      const n = noun(p);
      const d = data.get(p.dataset);
      const kinds = p.kinds.map((x) => kindsOf(d).find((f) => f.value === x)?.label ?? x);
      return [
        `the ${p.items.length} ${n} form ${p.groups.length} groups of ${k}; the ${n} in a group share something.`,
        `select ${k} and submit them. a wrong group is a mistake; ${p.mistakes} mistakes end the game. "one away" means ${k - 1} of them belong together.`,
        `the links are among: ${kinds.join(", ")}. some ${n} fit more than one link, but there is only one way to split the whole board.`,
        "groups go from easiest (yellow) to hardest (purple).",
      ];
    },
    describe: (p) => `${p.groups.length} groups of ${groupSize(p)}`,
    describeAction: (p, a, _before, after) => {
      const g = groupOf(p, a.items);
      if (g >= 0) return `found: ${bd(p).links[g]!.label}`;
      return `${a.items.map((id) => name(p, id)).join(", ")}: wrong${oneAway(p, after) ? ", one away" : ""}`;
    },
  };
}
