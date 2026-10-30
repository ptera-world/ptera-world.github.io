import type { Rng } from "../../core/rng";
import { defineSchema, type Values } from "../../core/schema";
import type { DataAttribute, PuzzleDef } from "../../core/types";
import { formatValue } from "../../lib/dataset/compare";
import { poolField, poolOf, POOL_PRESETS } from "../../lib/pokemon/pool";
import type { PokemonDataset, PokemonItem } from "../../lib/pokemon/types";

/**
 * The attributes a round can ask about: the dataset's number attributes with enough spread that
 * most pairs differ (happiness and egg cycles have under a dozen values, so nearly every pair ties).
 * Labels are repeated here because the params form is built before the dataset loads.
 */
export const ATTRIBUTES = [
  { value: "bst", label: "base stat total" },
  { value: "hp", label: "hp" },
  { value: "atk", label: "attack" },
  { value: "def", label: "defense" },
  { value: "spa", label: "sp. attack" },
  { value: "spd", label: "sp. defense" },
  { value: "spe", label: "speed" },
  { value: "height", label: "height" },
  { value: "weight", label: "weight" },
  { value: "capture", label: "catch rate" },
  { value: "dex", label: "dex number" },
] as const;

export const STATS = ["hp", "atk", "def", "spa", "spd", "spe"] as const;

export function makeParams(ds: () => PokemonDataset | undefined) {
  return defineSchema({
    attributes: {
      type: "set", label: "compare by", default: ["bst"], options: ATTRIBUTES,
      description: "one: every round asks about it. several: each round asks about one of them, picked at random",
    },
    pool: poolField(ds),
    lives: { type: "int", label: "lives", default: 1, min: 1, max: 5, description: "wrong answers you can make before the run ends" },
    length: { type: "int", label: "pokémon in a run", default: 100, min: 5, max: 500, description: "the run is won once you get through this many (or the whole pool, if smaller)" },
  });
}

export type Params = ReturnType<typeof makeParams>;

export interface HLPuzzle {
  /** Item ids in the order they come in; round k compares seq[k] (left) with seq[k + 1] (right). */
  seq: string[];
  /** Attribute id asked about in each round (seq.length - 1 of them). */
  attrs: string[];
  lives: number;
}

export interface HLState {
  /** Whether each answered round was right, in order. */
  results: boolean[];
}

export type Dir = "higher" | "lower";
export type HLAction = { type: "guess"; dir: Dir };

/** What the game reads from the dataset: an item's value for an attribute, and how to show it. */
export interface Lookup {
  value(id: string, attr: string): number;
  attribute(attr: string): DataAttribute;
  item(id: string): PokemonItem;
}

const lookups = new WeakMap<PokemonDataset, Lookup>();

export function lookupOf(ds: PokemonDataset): Lookup {
  let l = lookups.get(ds);
  if (l) return l;
  const byId = new Map(ds.items().map((i) => [i.id, i]));
  const item = (id: string) => {
    const it = byId.get(id);
    if (!it) throw new Error(`this game names a pokémon (${id}) the loaded pokémon data doesn't have`);
    return it;
  };
  lookups.set(ds, l = {
    item,
    value: (id, attr) => Number(item(id).values[attr]),
    attribute: (attr) => {
      const a = ds.attributes.find((x) => x.id === attr);
      if (!a) throw new Error(`the pokémon data has no "${attr}"`);
      return a;
    },
  });
  return l;
}

export const rounds = (p: HLPuzzle): number => p.seq.length - 1;
export const mistakes = (s: HLState): number => s.results.reduce((n, r) => n + (r ? 0 : 1), 0);
export const correct = (s: HLState): number => s.results.length - mistakes(s);
export const isOver = (p: HLPuzzle, s: HLState): boolean => mistakes(s) >= p.lives || s.results.length >= rounds(p);

/** The right answer for round k: where the right one's value lies from the left one's; null for a tie (either is right). */
export function answer(p: HLPuzzle, k: number, look: Lookup): Dir | null {
  const a = p.attrs[k]!;
  const l = look.value(p.seq[k]!, a), r = look.value(p.seq[k + 1]!, a);
  return r > l ? "higher" : r < l ? "lower" : null;
}

export function reduce(p: HLPuzzle, s: HLState, a: HLAction, look: Lookup): HLState {
  if (a.type !== "guess" || (a.dir !== "higher" && a.dir !== "lower") || isOver(p, s)) return s;
  const want = answer(p, s.results.length, look);
  return { results: [...s.results, want === null || want === a.dir] };
}

/** Values compared in round k, as shown. */
export function shown(p: HLPuzzle, k: number, look: Lookup): { attr: DataAttribute; left: string; right: string } {
  const attr = look.attribute(p.attrs[k]!);
  return { attr, left: formatValue(attr, look.value(p.seq[k]!, attr.id)), right: formatValue(attr, look.value(p.seq[k + 1]!, attr.id)) };
}

export function generate(v: Values<Params>, rng: Rng, ds: PokemonDataset): HLPuzzle {
  const attrs = ATTRIBUTES.map((a) => a.value).filter((a) => v.attributes.includes(a));
  if (!attrs.length) throw new Error("pick at least one thing to compare by");
  for (const a of attrs) if (!ds.attributes.some((x) => x.id === a)) throw new Error(`the pokémon data has no "${a}"`);
  // a pokémon missing a value can't be compared on it
  const pool = poolOf(ds, v.pool, 2).filter((i) => attrs.every((a) => typeof i.values[a] === "number"));
  if (pool.length < 2) throw new Error("the pokémon filter leaves fewer than 2 pokémon with these values");
  const seq = rng.shuffle(pool.map((i) => i.id)).slice(0, v.length);
  const pickAttr = rng.fork("attributes");
  return { seq, attrs: seq.slice(1).map(() => pickAttr.pick(attrs)), lives: v.lives };
}

export const label = (attr: string): string => ATTRIBUTES.find((a) => a.value === attr)?.label ?? attr;

/** "base stat total", or "base stat total, speed" for a run that mixes them. */
export function attrsLabel(p: HLPuzzle): string {
  const used = ATTRIBUTES.map((a) => a.value).filter((a) => p.attrs.includes(a));
  return used.length > 3 ? `${used.length} things, mixed` : used.map(label).join(", ");
}

const SQUARES_MAX = 50;

/** Spoiler-free: the score, and a square per round (rows of ten) unless the run is long. */
export function shareText(name: string, p: HLPuzzle, s: HLState): string {
  const lines = [`${name} · ${attrsLabel(p)}`, p.lives > 1 ? `${correct(s)} right, ${p.lives} lives` : `streak ${correct(s)}`];
  if (s.results.length <= SQUARES_MAX) {
    const sq = s.results.map((r) => (r ? "🟩" : "🟥"));
    for (let i = 0; i < sq.length; i += 10) lines.push(sq.slice(i, i + 10).join(""));
  }
  if (s.results.length >= rounds(p) && mistakes(s) < p.lives) lines.push("whole run cleared");
  return lines.join("\n");
}

/**
 * The puzzle definition. Values come from the dataset, read when needed (it's provided by another
 * pack, which may load after this one).
 */
export function makeHigherLower(ds: () => PokemonDataset | undefined): PuzzleDef<HLPuzzle, HLState, HLAction, null, Params> {
  const look = (): Lookup => {
    const d = ds();
    if (!d) throw new Error("the pokémon data pack isn't loaded");
    return lookupOf(d);
  };
  const params = makeParams(ds);
  return {
    id: "pokemon-higher-lower",
    name: "Higher or lower",
    aliases: ["pokémon higher or lower", "the higher lower game", "pokemon stats game", "bst game"],
    tags: ["pokémon", "trivia", "streak"],
    description: "two pokémon side by side, the left one's stat shown. is the right one's higher or lower? keep going until you get one wrong.",
    datasets: ["pokemon"],
    generatorVersion: 1,
    params,
    presets: [
      { label: "base stat total", params: {} },
      { label: "any base stat, changing each round", params: { attributes: [...STATS] } },
      { label: "height and weight", params: { attributes: ["height", "weight"] } },
      { label: "everything, 3 lives", params: { attributes: ATTRIBUTES.map((a) => a.value), lives: 3 } },
      ...POOL_PRESETS.filter((x) => x.pool !== "form:default").map((x) => ({ label: `base stat total, ${x.label}`, params: { pool: x.pool } })),
    ],
    daily: { params: {} },
    // an answer, once marked, stands: undoing it would let a run retry its mistakes
    irreversible: true,
    generate: (v, rng) => {
      const d = ds();
      if (!d) throw new Error("the pokémon data pack isn't loaded");
      return generate(v, rng, d);
    },
    formats: [],
    init: () => ({ results: [] }),
    reduce: (p, s, a) => reduce(p, s, a, look()),
    // clearing the run wins it; running out of lives is game over (the score stands either way)
    isSolved: (p, s) => s.results.length >= rounds(p) && mistakes(s) < p.lives,
    isLost: (p, s) => mistakes(s) >= p.lives,
    solve: (p, s) => {
      if (isOver(p, s)) return null;
      const l = look();
      const moves: HLAction[] = [];
      for (let k = s.results.length; k < rounds(p); k++) moves.push({ type: "guess", dir: answer(p, k, l) ?? "higher" });
      return { moves };
    },
    score: (_p, s) => ({ value: correct(s), label: `${correct(s)} right`, better: "higher" }),
    shareText: (p, s) => shareText("higher or lower", p, s),
    verdict: (p, s) => {
      const n = correct(s);
      if (mistakes(s) < p.lives) return `run cleared: ${n} right`;
      return p.lives > 1 ? `out of lives: ${n} right` : `streak of ${n}`;
    },
    rules: (p) => [
      `two pokémon side by side. you see the left one's ${attrsLabel(p)}${new Set(p.attrs).size > 1 ? " (which one changes each round)" : ""}.`,
      "say whether the right one's is higher or lower. if they're equal, either answer is right.",
      "then the right one moves to the left, and a new one comes in.",
      p.lives > 1 ? `you have ${p.lives} lives: the run ends after ${p.lives} wrong answers.` : "the run ends at your first wrong answer.",
      `get through all ${p.seq.length} pokémon to clear the run.`,
    ],
    describe: (p) => `${attrsLabel(p)}${p.lives > 1 ? `, ${p.lives} lives` : ""}`,
    describeAction: (p, a, before, after) => {
      const k = before.results.length;
      const l = look();
      const what = `${l.item(p.seq[k + 1]!).name}: ${a.dir} than ${l.item(p.seq[k]!).name}`;
      return after.results.length > k ? `${what} (${after.results[k] ? "right" : "wrong"})` : what;
    },
  };
}
