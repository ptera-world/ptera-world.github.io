import type { Rng } from "../../core/rng";
import { defineSchema, type Values } from "../../core/schema";
import type { DataAttribute, PuzzleDef } from "../../core/types";
import { formatValue } from "../../lib/dataset/compare";
import { poolField, poolOf } from "../../lib/pokemon/pool";
import type { PokemonDataset, PokemonItem } from "../../lib/pokemon/types";

/** Attributes worth sorting by: numbers with enough distinct values that ties stay rare. */
export const SORTABLE = [
  { value: "weight", label: "weight" },
  { value: "height", label: "height" },
  { value: "bst", label: "base stat total" },
  { value: "hp", label: "hp" },
  { value: "atk", label: "attack" },
  { value: "def", label: "defense" },
  { value: "spa", label: "sp. attack" },
  { value: "spd", label: "sp. defense" },
  { value: "spe", label: "speed" },
  { value: "dex", label: "dex number" },
  { value: "capture", label: "catch rate" },
] as const;

/** What a submitted order says about each position. */
export type Feedback = "near" | "direction" | "place" | "exact";

export interface SortPuzzle {
  /** Item ids in the order first shown. */
  ids: string[];
  /** Attribute id sorted by. */
  attr: string;
  /** Highest at the top. */
  high: boolean;
  tries: number;
  feedback: Feedback;
}

export interface Try {
  order: string[];
  /** Per position: how many places down (+) or up (−) that item belongs; 0 = right. */
  off: number[];
}

export interface SortState {
  /** The order being built (item ids, top first). */
  order: string[];
  tries: Try[];
}

export type SortAction =
  | { type: "move"; from: number; to: number }
  | { type: "order"; order: string[] }
  | { type: "submit" };

/**
 * How far each item sits from where it belongs, by value: an item belongs anywhere its value
 * falls in the sorted order, so equal values may go either way round.
 */
export function offsets(values: readonly number[], high: boolean): number[] {
  const sorted = values.slice().sort((a, b) => (high ? b - a : a - b));
  return values.map((v, i) => {
    const lo = sorted.indexOf(v), hi = sorted.lastIndexOf(v);
    return i < lo ? lo - i : i > hi ? hi - i : 0;
  });
}

/** Positions that may not move: right in the last try (they can only get worse). */
export function pinned(s: SortState): boolean[] {
  const last = s.tries[s.tries.length - 1];
  return s.order.map((_, i) => last?.off[i] === 0);
}

/**
 * Move the item at `from` to `to`, the others shifting to make room; pinned positions keep their
 * items, as if the free positions were a list of their own.
 */
export function moveFree(order: readonly string[], pin: readonly boolean[], from: number, to: number): string[] | null {
  if (from === to || pin[from] || pin[to] || from < 0 || to < 0 || from >= order.length || to >= order.length) return null;
  const free = order.map((_, i) => i).filter((i) => !pin[i]);
  const ids = free.map((i) => order[i]!);
  const a = free.indexOf(from), b = free.indexOf(to);
  const [it] = ids.splice(a, 1);
  ids.splice(b, 0, it!);
  const out = order.slice();
  free.forEach((pos, k) => { out[pos] = ids[k]!; });
  return out;
}

export function isSolved(_p: SortPuzzle, s: SortState): boolean {
  const last = s.tries[s.tries.length - 1];
  return !!last && last.off.every((o) => o === 0);
}

export const isOver = (p: SortPuzzle, s: SortState): boolean => isSolved(p, s) || s.tries.length >= p.tries;

/** What a mark shows for an offset under the puzzle's feedback. */
export function markOf(off: number, feedback: Feedback): { cls: "right" | "near" | "far"; arrow: "" | "↑" | "↓"; text: string } {
  if (off === 0) return { cls: "right", arrow: "", text: "✓" };
  const arrow = off > 0 ? "↓" : "↑";
  switch (feedback) {
    case "place": return { cls: "far", arrow: "", text: "✗" };
    case "direction": return { cls: "far", arrow, text: arrow };
    case "exact": return { cls: Math.abs(off) === 1 ? "near" : "far", arrow, text: `${arrow}${Math.abs(off)}` };
    default: return { cls: Math.abs(off) === 1 ? "near" : "far", arrow, text: arrow };
  }
}

export function makeSort(data: () => PokemonDataset | undefined) {
  const dataset = (): PokemonDataset => {
    const d = data();
    if (!d) throw new Error("the pokémon data pack isn't loaded");
    return d;
  };
  const itemCache = new Map<string, PokemonItem>();
  const item = (id: string): PokemonItem => {
    const d = dataset();
    let it = itemCache.get(`${d.version}|${id}`);
    if (!it) {
      it = d.items().find((x) => x.id === id);
      if (!it) throw new Error(`no pokémon ${id} in this version of the data`);
      itemCache.set(`${d.version}|${id}`, it);
    }
    return it;
  };
  const attrOf = (id: string): DataAttribute => {
    const a = dataset().attributes.find((x) => x.id === id);
    if (!a) throw new Error(`the pokémon data has no ${id}`);
    return a;
  };
  const value = (p: SortPuzzle, id: string): number => Number(item(id).values[p.attr] ?? NaN);
  const label = (attr: string) => SORTABLE.find((s) => s.value === attr)?.label ?? attrOf(attr).label;

  const params = defineSchema({
    attr: {
      type: "enum", label: "sort by", default: "random",
      options: [{ value: "random", label: "a different one each game" }, ...SORTABLE],
    },
    count: { type: "int", label: "how many pokémon", default: 6, min: 3, max: 10 },
    tries: { type: "int", label: "tries", default: 4, min: 1, max: 10 },
    feedback: {
      type: "enum", label: "marks", default: "near",
      options: [
        { value: "near", label: "right, one off, or which way", description: "each one says ✓, or which way it belongs, highlighted when it is one place off" },
        { value: "direction", label: "right or which way" },
        { value: "exact", label: "how many places off (easy)" },
        { value: "place", label: "right or wrong only (hard)" },
      ],
    },
    order: {
      type: "enum", label: "top of the list", default: "high",
      options: [{ value: "high", label: "highest" }, { value: "low", label: "lowest" }],
    },
    spread: {
      type: "enum", label: "how far apart", default: "any",
      options: [
        { value: "any", label: "anything" },
        { value: "close", label: "close together (hard)", description: "all from a narrow stretch of the values" },
      ],
    },
    pool: poolField(data),
  });

  function generate(v: Values<typeof params>, rng: Rng): SortPuzzle {
    const d = dataset();
    const attr = v.attr === "random" ? rng.pick(SORTABLE).value : v.attr;
    const valueOf = (it: PokemonItem) => it.values[attr];
    const pool = poolOf(d, v.pool, v.count).filter((it) => typeof valueOf(it) === "number");
    // one per value: equal values would be free marks
    const byValue = new Map<number, PokemonItem[]>();
    for (const it of pool) {
      const k = valueOf(it) as number;
      byValue.set(k, [...(byValue.get(k) ?? []), it]);
    }
    const values = [...byValue.keys()].sort((a, b) => a - b);
    if (values.length < v.count) throw new Error(`those pokémon have only ${values.length} different values of ${label(attr)}; pick fewer pokémon or a wider filter`);
    let chosen: number[];
    if (v.spread === "close") {
      const width = Math.min(values.length, v.count * 3);
      const start = rng.int(values.length - width + 1);
      chosen = rng.shuffle(values.slice(start, start + width)).slice(0, v.count);
    } else chosen = rng.shuffle(values.slice()).slice(0, v.count);
    const items = chosen.map((k) => rng.pick(byValue.get(k)!));
    let ids = rng.shuffle(items.map((it) => it.id));
    const high = v.order === "high";
    // never start already in order
    for (let k = 0; k < 10 && offsets(ids.map((id) => valueOf(pool.find((x) => x.id === id)!) as number), high).every((o) => o === 0); k++) ids = rng.shuffle(ids);
    return { ids, attr, high, tries: v.tries, feedback: v.feedback as Feedback };
  }

  function reduce(p: SortPuzzle, s: SortState, a: SortAction): SortState {
    if (isOver(p, s)) return s;
    switch (a.type) {
      case "move": {
        const order = moveFree(s.order, pinned(s), a.from, a.to);
        return order ? { ...s, order } : s;
      }
      case "order": {
        const pin = pinned(s);
        if (a.order.length !== s.order.length || [...a.order].sort().join() !== [...s.order].sort().join()) return s;
        if (a.order.some((id, i) => pin[i] && id !== s.order[i]) || a.order.every((id, i) => id === s.order[i])) return s;
        return { ...s, order: a.order.slice() };
      }
      case "submit": {
        const off = offsets(s.order.map((id) => value(p, id)), p.high);
        return { ...s, tries: [...s.tries, { order: s.order.slice(), off }] };
      }
      default:
        return s;
    }
  }

  /** A right order from `s`: pinned items stay, the rest go in order around them. */
  function sortedFrom(p: SortPuzzle, s: SortState): string[] {
    const pin = pinned(s);
    const rest = s.order.filter((_, i) => !pin[i]).sort((a, b) => (p.high ? value(p, b) - value(p, a) : value(p, a) - value(p, b)));
    let k = 0;
    return s.order.map((id, i) => (pin[i] ? id : rest[k++]!));
  }

  const SQUARE = { right: "🟩", near: "🟨", far: "⬜" } as const;

  const def: PuzzleDef<SortPuzzle, SortState, SortAction, null, typeof params> = {
    id: "pokemon-sort",
    name: "pokémon sort",
    aliases: ["sorted", "timeline", "order up", "higher or lower", "rank them"],
    tags: ["pokémon", "ordering", "trivia"],
    description: "put the pokémon in order by weight, height, a stat or another number. each try marks which ones are in the right place and which way the others belong.",
    generatorVersion: 1,
    datasets: ["pokemon"],
    params,
    presets: [
      { label: "6 pokémon, 4 tries", params: {} },
      { label: "easy: 5 pokémon, marks say how far", params: { count: 5, feedback: "exact" } },
      { label: "hard: 8 close together", params: { count: 8, tries: 5, spread: "close" } },
      { label: "weight", params: { attr: "weight" } },
      { label: "base stat total", params: { attr: "bst" } },
      { label: "speed, gen 1", params: { attr: "spe", pool: "form:default gen:1" } },
    ],
    daily: { params: {} },
    // undoing a try would hand back a try already marked
    irreversible: true,
    generate,
    formats: [],
    init: (p) => ({ order: p.ids.slice(), tries: [] }),
    reduce,
    isSolved,
    isLost: (p, s) => !isSolved(p, s) && s.tries.length >= p.tries,
    solve: (p, s) => {
      if (isSolved(p, s)) return null;
      if (s.tries.length >= p.tries) return null;
      const order = sortedFrom(p, s);
      return { moves: [...(order.every((id, i) => id === s.order[i]) ? [] : [{ type: "order" as const, order }]), { type: "submit" as const }] };
    },
    hint: (p, s) => {
      if (isOver(p, s)) return null;
      const want = sortedFrom(p, s);
      const pin = pinned(s);
      // place one item: the topmost free position holding the wrong one
      const at = s.order.findIndex((id, i) => !pin[i] && value(p, id) !== value(p, want[i]!));
      if (at < 0) return { message: "this order is right: submit it", actions: [{ type: "submit" }] };
      const from = s.order.findIndex((id, i) => !pin[i] && i !== at && value(p, id) === value(p, want[at]!));
      return { message: `${item(s.order[from]!).name} belongs in place ${at + 1}`, actions: [{ type: "move", from, to: at }] };
    },
    rules: (p) => [
      `put the ${p.ids.length} pokémon in order of ${label(p.attr)}, ${p.high ? "highest" : "lowest"} at the top. pokémon with the same ${label(p.attr)} may go either way round.`,
      `you have ${p.tries} ${p.tries === 1 ? "try" : "tries"}. each try marks every pokémon: ✓ in the right place${
        p.feedback === "place" ? ", ✗ if not."
        : p.feedback === "direction" ? ", else an arrow saying whether it belongs higher or lower."
        : p.feedback === "exact" ? ", else an arrow and how many places it belongs higher or lower."
        : ", else an arrow saying whether it belongs higher or lower, highlighted when it is just one place off."}`,
      "pokémon marked ✓ stay put; the others move around them.",
    ],
    describe: (p) => `${p.ids.length} by ${label(p.attr)}`,
    describeAction: (_p, a, before) => {
      if (a.type === "move") return `move ${item(before.order[a.from]!).name} to place ${a.to + 1}`;
      if (a.type === "order") return "reorder";
      return "submit";
    },
    score: (p, s) => (isSolved(p, s) ? { value: s.tries.length, label: "tries", better: "lower" } : null),
    shareText: (p, s) => {
      const head = `pokémon sort, ${label(p.attr)}: ${isSolved(p, s) ? s.tries.length : "X"}/${p.tries}`;
      return [head, ...s.tries.map((t) => t.off.map((o) => SQUARE[markOf(o, p.feedback).cls]).join(""))].join("\n");
    },
  };

  return { def, params, item, value, label, attrOf, sortedFrom, show: (p: SortPuzzle, id: string) => formatValue(attrOf(p.attr), item(id).values[p.attr] ?? null) };
}

export type SortGame = ReturnType<typeof makeSort>;
