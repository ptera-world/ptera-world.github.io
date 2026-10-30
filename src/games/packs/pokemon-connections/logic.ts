import type { Rng } from "../../core/rng";
import { defineSchema, type Values } from "../../core/schema";
import type { GenerateContext, PuzzleDef } from "../../core/types";
import { facet, facets, FACET_KINDS, type Facet } from "../../lib/pokemon/facets";
import { poolField, poolOf } from "../../lib/pokemon/pool";
import type { PokemonDataset, PokemonItem } from "../../lib/pokemon/types";

export interface Group {
  /** Facet id (lib/pokemon/facets): the link. */
  link: string;
  items: string[];
  /** 0 easiest (yellow) up. */
  tier: number;
}

export interface ConnPuzzle {
  /** Every pokémon on the board, in the order first shown. */
  items: string[];
  /** Easiest first. */
  groups: Group[];
  /** Wrong guesses that end the game. */
  mistakes: number;
  /** Facet kinds the generator checked uniqueness against: the links that could be in play. */
  kinds: string[];
  /** Filter query for the pokémon in play (links every one of them shares are no links). */
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

export type Dataset = () => PokemonDataset | undefined;

export function needDataset(get: Dataset): PokemonDataset {
  const ds = get();
  if (!ds) throw new Error("the pokémon data pack isn't loaded");
  return ds;
}

/** Links offered unless the player picks others. Mono/dual-type, evolution stage and numbers split the board too evenly to make good groups, so they are opt-in. */
export const DEFAULT_KINDS = ["type", "gen", "class", "forms", "color", "shape", "egg", "ability", "gender", "family"];

/**
 * How hard a link is to see, before red herrings: an evolution family or a mega shows on the
 * tiles, a type most players know on sight, pokédex shapes, egg groups and abilities take
 * knowing the games. A judgement, used only to order the groups into tiers.
 */
const KIND_DIFFICULTY: Record<string, number> = {
  family: 0, forms: 0.5, type: 1, class: 1.5, typing: 2, gen: 2, color: 2, evo: 2.5, gender: 2.5, size: 3, shape: 3, stats: 3.5, egg: 3.5, ability: 4,
};

/** How often each kind is drawn as a link, relative to the others. */
const KIND_WEIGHT: Record<string, number> = { type: 3, gen: 2, family: 0.6 };

export const TIER_COLORS = ["#f9df6d", "#a0c35a", "#b0c4ef", "#ba81c5", "#f0a35e", "#e98fa0"];
export const TIER_EMOJI = ["🟨", "🟩", "🟦", "🟪", "🟧", "🟥"];

export function makeParams(get: Dataset) {
  return defineSchema({
    groups: { type: "int", label: "groups", default: 4, min: 3, max: 6 },
    size: { type: "int", label: "pokémon per group", default: 4, min: 3, max: 5 },
    mistakes: { type: "int", label: "mistakes allowed", default: 4, min: 1, max: 10 },
    difficulty: {
      type: "enum", label: "red herrings", default: "normal",
      description: "pokémon that also fit another group's link",
      options: [{ value: "easy", label: "few" }, { value: "normal", label: "some" }, { value: "hard", label: "many" }],
    },
    kinds: { type: "set", label: "links in play", default: DEFAULT_KINDS, options: FACET_KINDS },
    pool: poolField(get),
  });
}

export type ConnParams = Values<ReturnType<typeof makeParams>>;

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
 * facets: `members[f]` lists the items facet f holds for.
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

/** Facets of the kinds in play that hold for at least `k` of `items`, with which. */
function linksAmong(all: readonly Facet[], items: readonly PokemonItem[], k: number): { f: Facet; members: number[] }[] {
  const out: { f: Facet; members: number[] }[] = [];
  for (const f of all) {
    const members: number[] = [];
    items.forEach((it, i) => { if (f.test(it)) members.push(i); });
    if (members.length >= k) out.push({ f, members });
  }
  return out;
}

/** A facet fitting more than this share of the pool tells its pokémon apart from too few others to be a link. */
const EVERYONE = 0.9;

/** Facets of `kinds` that can be links among `pool`: all but those (nearly) every pokémon in play shares. */
export function linkFacets(ds: PokemonDataset, kinds: readonly string[], pool: readonly PokemonItem[]): Facet[] {
  return facets(ds, kinds).filter((f) => pool.filter(f.test).length < pool.length * EVERYONE);
}

/** True if splitting `items` into groups of `k` sharing one of `links` can be done exactly one way. */
export function unique(links: readonly Facet[], items: readonly PokemonItem[], k: number): boolean {
  return countPartitions(items.length, k, linksAmong(links, items, k).map((l) => l.members)) === 1;
}

// --- generation ---

function pickKindWeighted<T extends { f: Facet }>(rng: Rng, cands: readonly T[]): T | null {
  if (!cands.length) return null;
  const kinds = [...new Set(cands.map((c) => c.f.kind))];
  const w = kinds.map((k) => KIND_WEIGHT[k] ?? 1);
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

export async function generate(ds: PokemonDataset, v: ConnParams, rng: Rng, ctx: GenerateContext): Promise<ConnPuzzle> {
  const n = v.groups * v.size;
  const kinds = v.kinds.length ? [...v.kinds] : DEFAULT_KINDS;
  const pool = poolOf(ds, v.pool, n);
  const all = linkFacets(ds, kinds, pool);
  const cands = all.flatMap((f) => {
    const idx: number[] = [];
    pool.forEach((it, i) => { if (f.test(it)) idx.push(i); });
    return idx.length >= v.size ? [{ f, idx }] : [];
  });
  if (cands.length < v.groups) throw new Error(`only ${cands.length} links fit ${v.size} or more of these pokémon; allow more kinds of links or more pokémon`);
  const pH = HERRING_P[v.difficulty] ?? 0.3;
  const found: { groups: { f: Facet; items: PokemonItem[] }[]; herrings: number }[] = [];
  const want = v.difficulty === "normal" ? 5 : 8;
  for (let attempt = 0; attempt < 4000 && found.length < want; attempt++) {
    if (attempt % 8 === 0) await ctx.yield();
    const chosen: typeof cands = [];
    while (chosen.length < v.groups) {
      const c = pickKindWeighted(rng, cands.filter((x) => !chosen.includes(x)
        && chosen.filter((y) => y.f.kind === x.f.kind).length < (x.f.kind === "family" || x.f.kind === "forms" ? 1 : 2)));
      if (!c) break;
      chosen.push(c);
    }
    if (chosen.length < v.groups) continue;
    const species = new Set<number>();
    const groups: { f: Facet; items: PokemonItem[] }[] = [];
    for (const c of rng.shuffle(chosen.slice())) {
      const others = chosen.filter((x) => x !== c);
      const free = c.idx.map((i) => pool[i]!).filter((it) => !species.has(it.species));
      const herring = free.filter((it) => others.some((o) => o.f.test(it)));
      const plain = free.filter((it) => !others.some((o) => o.f.test(it)));
      const picks: PokemonItem[] = [];
      while (picks.length < v.size) {
        const fromH = herring.filter((it) => !picks.includes(it) && !picks.some((x) => x.species === it.species));
        const fromP = plain.filter((it) => !picks.includes(it) && !picks.some((x) => x.species === it.species));
        const src = (rng.next() < pH && fromH.length) || !fromP.length ? fromH : fromP;
        if (!src.length) break;
        picks.push(rng.pick(src));
      }
      if (picks.length < v.size) break;
      for (const it of picks) species.add(it.species);
      groups.push({ f: c.f, items: picks });
    }
    if (groups.length < v.groups) continue;
    const items = groups.flatMap((g) => g.items);
    const links = linksAmong(all, items, v.size);
    if (countPartitions(items.length, v.size, links.map((l) => l.members)) !== 1) continue;
    // red herrings: pokémon outside a group that fit its link, and links of no group that still fit enough of the board
    let herrings = 0;
    for (const g of groups) herrings += items.filter((it) => !g.items.includes(it) && g.f.test(it)).length;
    herrings += 0.5 * links.filter((l) => !groups.some((g) => g.f.id === l.f.id)).length;
    found.push({ groups, herrings });
  }
  if (!found.length) throw new Error("no board found where the groups can only be split one way; allow more kinds of links, more pokémon, or smaller groups");
  found.sort((a, b) => a.herrings - b.herrings);
  const best = v.difficulty === "easy" ? found[0]! : v.difficulty === "hard" ? found[found.length - 1]! : found[Math.floor(found.length / 2)]!;
  const items = best.groups.flatMap((g) => g.items);
  const scored = best.groups.map((g) => ({
    g,
    d: (KIND_DIFFICULTY[g.f.kind] ?? 2) + 0.75 * items.filter((it) => !g.items.includes(it) && g.f.test(it)).length,
  })).sort((a, b) => a.d - b.d);
  return {
    items: rng.shuffle(items.map((it) => it.id)),
    groups: scored.map(({ g }, tier) => ({ link: g.f.id, items: g.items.map((it) => it.id), tier })),
    mistakes: v.mistakes,
    kinds,
    pool: v.pool,
  };
}

export interface Board {
  byId: Map<string, PokemonItem>;
  links: Facet[];
}

const boards = new WeakMap<ConnPuzzle, Board>();

export function board(ds: PokemonDataset, p: ConnPuzzle): Board {
  let b = boards.get(p);
  if (!b) {
    const all = new Map(ds.items().map((it) => [it.id, it]));
    boards.set(p, b = { byId: new Map(p.items.flatMap((id) => (all.has(id) ? [[id, all.get(id)!] as const] : []))), links: p.groups.map((g) => facet(ds, g.link)) });
  }
  return b;
}

export function makeConnections(get: Dataset): PuzzleDef<ConnPuzzle, ConnState, ConnAction, ConnInteraction, ReturnType<typeof makeParams>> {
  const params = makeParams(get);
  const bd = (p: ConnPuzzle) => board(needDataset(get), p);
  const name = (p: ConnPuzzle, id: string) => bd(p).byId.get(id)?.name ?? id;
  return {
    id: "pokemon-connections",
    name: "pokémon connections",
    aliases: ["connections", "nyt connections", "groups", "only connect"],
    tags: ["pokémon", "trivia", "words"],
    description: "sixteen pokémon, four hidden groups of four that share something: a type, a generation, a pokédex color, an ability… find every group before you run out of mistakes.",
    datasets: ["pokemon"],
    generatorVersion: 1,
    params,
    presets: [
      { label: "classic (4 groups of 4)", params: {} },
      { label: "gentle (few red herrings)", params: { difficulty: "easy" } },
      { label: "devious (many red herrings)", params: { difficulty: "hard" } },
      { label: "small (3 groups of 3)", params: { groups: 3, size: 3 } },
      { label: "big (5 groups of 5)", params: { groups: 5, size: 5, mistakes: 5 } },
      { label: "gen 1 only", params: { pool: "form:default gen:1", kinds: ["type", "class", "color", "shape", "egg", "ability", "family", "evo", "gender"] } },
      { label: "with megas and regional forms", params: { pool: "form:default,mega,regional" } },
      { label: "numbers too (weight, height, stats)", params: { kinds: [...DEFAULT_KINDS, "size", "stats"] } },
    ],
    daily: { params: {} },
    generate: (v, rng, ctx) => generate(needDataset(get), v, rng, ctx),
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
      return [`pokémon connections${isSolved(p, s) ? "" : " (not solved)"}`, ...rows].join("\n");
    },
    rules: (p) => {
      const k = groupSize(p);
      const kinds = p.kinds.map((x) => FACET_KINDS.find((f) => f.value === x)?.label ?? x);
      return [
        `the ${p.items.length} pokémon form ${p.groups.length} groups of ${k}; the pokémon in a group share something.`,
        `select ${k} and submit them. a wrong group is a mistake; ${p.mistakes} mistakes end the game. "one away" means ${k - 1} of them belong together.`,
        `the links are among: ${kinds.join(", ")}. some pokémon fit more than one link, but there is only one way to split the whole board.`,
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
