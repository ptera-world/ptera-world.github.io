import type { Rng } from "../../core/rng";
import { defineSchema, effective, type FieldOption, type Values } from "../../core/schema";
import type { DataAttribute, DataItem, Dataset, Hint, PuzzleDef } from "../../core/types";
import { formatValue } from "../../lib/dataset/compare";
import { filter } from "../../lib/dataset/query";

/** The datasets the game can be played on, looked up when needed (packs load in any order). */
export interface DataSource {
  get(id: string): Dataset | undefined;
  list(): readonly Dataset[];
}

/** Attributes things can be put in order by: numbers. */
export const orderable = (d: Dataset | undefined): DataAttribute[] => (d?.attributes ?? []).filter((a) => a.kind === "number");

/**
 * How a game goes:
 * - sort: all of them at once; each try marks every place (sorting games with wordle-like marks)
 * - line: one at a time, each put into a line that grows (Timeline, Wikitrivia)
 * - last: one at a time, higher or lower than the one before (the Higher Lower game)
 */
export type Mode = "sort" | "line" | "last";

/** What a sorting try says about each place. */
export type Marks = "near" | "direction" | "place" | "exact";

export function makeParams(data: DataSource) {
  const ds = (v: Record<string, unknown>) => data.get(String(v.dataset));
  return defineSchema({
    dataset: {
      type: "enum", label: "dataset",
      default: () => (data.get("pokemon") ? "pokemon" : data.list().find((d) => orderable(d).length)?.id ?? ""),
      options: () => data.list().filter((d) => orderable(d).length).map((d) => ({ value: d.id, label: d.name })),
    },
    pool: {
      type: "string", label: "which ones", default: (v) => ds(v)?.pools?.[0]?.query ?? "", placeholder: "a filter; empty: everything",
      filterOf: (v) => ds(v),
      check: (q, v) => {
        const d = ds(v);
        if (!d) return "that dataset's pack isn't loaded";
        const r = filter(d.items(), q, d.attributes);
        return "error" in r ? r.error : `${r.items.length} ${d.noun?.many ?? "items"}`;
      },
    },
    by: {
      type: "set", label: "in order of",
      default: (v) => {
        const nums = orderable(ds(v)).map((a) => a.id);
        const featured = (ds(v)?.featured ?? []).filter((id) => nums.includes(id));
        return featured.length ? featured : nums.slice(0, 1);
      },
      options: (v): FieldOption[] => orderable(ds(v)).map((a) => ({ value: a.id, label: a.label })),
      description: "several: each game (or, one at a time against the last, each round) asks about one of them, picked at random",
    },
    mode: {
      type: "enum", label: "how", default: "sort",
      options: [
        { value: "sort", label: "sort them all, with tries", description: "each try marks every place" },
        { value: "line", label: "one at a time, into a line", description: "put each new one where it belongs among the ones placed so far (Timeline, Wikitrivia)" },
        { value: "last", label: "one at a time: higher or lower than the last", description: "the Higher Lower game" },
      ],
    },
    count: { type: "int", label: "how many", default: 6, min: 3, max: 10, when: (v) => v.mode === "sort" },
    tries: { type: "int", label: "tries", default: 4, min: 1, max: 10, when: (v) => v.mode === "sort" },
    marks: {
      type: "enum", label: "marks", default: "near", when: (v) => v.mode === "sort",
      options: [
        { value: "near", label: "right, one off, or which way", description: "each one says ✓, or which way it belongs, highlighted when it is one place off" },
        { value: "direction", label: "right or which way" },
        { value: "exact", label: "how many places off (easy)" },
        { value: "place", label: "right or wrong only (hard)" },
      ],
    },
    spread: {
      type: "enum", label: "how far apart", default: "any", when: (v) => v.mode === "sort",
      options: [{ value: "any", label: "anything" }, { value: "close", label: "close together (hard)", description: "all from a narrow stretch of the values" }],
    },
    length: { type: "int", label: "how many in a run", default: (v) => (v.mode === "last" ? 100 : 30), min: 5, max: 500, when: (v) => v.mode !== "sort", description: "the run is won once you get through this many (or every one, if fewer)" },
    lives: { type: "int", label: "lives", default: (v) => (v.mode === "line" ? 3 : 1), min: 1, max: 10, when: (v) => v.mode !== "sort", description: "wrong answers you can make before the run ends" },
    top: {
      type: "enum", label: "at the top", default: "high", when: (v) => v.mode !== "last",
      options: [{ value: "high", label: "the highest" }, { value: "low", label: "the lowest" }],
    },
  });
}

export type Params = ReturnType<typeof makeParams>;

export interface OrderPuzzle {
  dataset: string;
  mode: Mode;
  /** Item ids: sort, in the order first shown; line and last, in the order they come (the first starts the line). */
  ids: string[];
  /** Attribute asked about: one for sort and line; one per round for last (ids.length - 1). */
  attrs: string[];
  /** Highest at the top. */
  high: boolean;
  tries: number;
  marks: Marks;
  lives: number;
}

export interface Try {
  order: string[];
  /** Per position: how many places down (+) or up (−) that item belongs; 0 = right. */
  off: number[];
}

export interface OrderState {
  /** Sort: the order being built (top first). */
  order: string[];
  tries: Try[];
  /** Line and last: whether each answer was right, in order. */
  results: boolean[];
}

export type Dir = "higher" | "lower";
export type OrderAction =
  | { type: "move"; from: number; to: number }
  | { type: "order"; order: string[] }
  | { type: "submit" }
  | { type: "place"; at: number }
  | { type: "guess"; dir: Dir };

// --- sorting ---

/** How far each item sits from where its value belongs; equal values may go either way. */
export function offsets(values: readonly number[], high: boolean): number[] {
  const sorted = values.slice().sort((a, b) => (high ? b - a : a - b));
  return values.map((v, i) => {
    const lo = sorted.indexOf(v), hi = sorted.lastIndexOf(v);
    return i < lo ? lo - i : i > hi ? hi - i : 0;
  });
}

/** Positions that may not move: right in the last try (they can only get worse). */
export function pinned(s: OrderState): boolean[] {
  const last = s.tries[s.tries.length - 1];
  return s.order.map((_, i) => last?.off[i] === 0);
}

/** Move the item at `from` to `to`, the others shifting; pinned positions keep their items. */
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

/** What a mark shows for an offset under the puzzle's marks. */
export function markOf(off: number, marks: Marks): { cls: "right" | "near" | "far"; arrow: "" | "↑" | "↓"; text: string } {
  if (off === 0) return { cls: "right", arrow: "", text: "✓" };
  const arrow = off > 0 ? "↓" : "↑";
  switch (marks) {
    case "place": return { cls: "far", arrow: "", text: "✗" };
    case "direction": return { cls: "far", arrow, text: arrow };
    case "exact": return { cls: Math.abs(off) === 1 ? "near" : "far", arrow, text: `${arrow}${Math.abs(off)}` };
    default: return { cls: Math.abs(off) === 1 ? "near" : "far", arrow, text: arrow };
  }
}

// --- one at a time ---

/** Line and last: rounds in a run, and how they went. */
export const rounds = (p: OrderPuzzle): number => p.ids.length - 1;
export const mistakes = (s: OrderState): number => s.results.reduce((n, r) => n + (r ? 0 : 1), 0);
export const correct = (s: OrderState): number => s.results.length - mistakes(s);

export function isSolved(p: OrderPuzzle, s: OrderState): boolean {
  if (p.mode === "sort") { const last = s.tries[s.tries.length - 1]; return !!last && last.off.every((o) => o === 0); }
  return s.results.length >= rounds(p) && mistakes(s) < p.lives;
}
export function isOver(p: OrderPuzzle, s: OrderState): boolean {
  if (p.mode === "sort") return isSolved(p, s) || s.tries.length >= p.tries;
  return mistakes(s) >= p.lives || s.results.length >= rounds(p);
}

/** Everything the game reads from the dataset for one puzzle. */
export interface Lookup {
  d: Dataset;
  item(id: string): DataItem;
  value(id: string, attr: string): number;
  attribute(attr: string): DataAttribute;
  show(id: string, attr: string): string;
}

const lookups = new WeakMap<Dataset, Lookup>();
export function lookupOf(d: Dataset): Lookup {
  let l = lookups.get(d);
  if (l) return l;
  const byId = new Map(d.items().map((i) => [i.id, i]));
  const item = (id: string) => {
    const it = byId.get(id);
    if (!it) throw new Error(`this game names one (${id}) the loaded ${d.name} data doesn't have`);
    return it;
  };
  const attribute = (attr: string) => {
    const a = d.attributes.find((x) => x.id === attr);
    if (!a) throw new Error(`the ${d.name} data has no "${attr}"`);
    return a;
  };
  lookups.set(d, l = {
    d, item, attribute,
    value: (id, attr) => Number(item(id).values[attr]),
    show: (id, attr) => formatValue(attribute(attr), item(id).values[attr] ?? null),
  });
  return l;
}

/** Line: the placed ones top to bottom (the first `results.length + 1` of the run). */
export function line(p: OrderPuzzle, s: OrderState, look: Lookup): string[] {
  const a = p.attrs[0]!;
  return p.ids.slice(0, s.results.length + 1).sort((x, y) => (p.high ? look.value(y, a) - look.value(x, a) : look.value(x, a) - look.value(y, a)));
}

/** Line: true if the next one belongs in gap `at` (0: above the top) of the placed ones. */
export function fitsAt(p: OrderPuzzle, s: OrderState, look: Lookup, at: number): boolean {
  const a = p.attrs[0]!;
  const L = line(p, s, look);
  const x = look.value(p.ids[s.results.length + 1]!, a);
  const ok = (upper: number, lower: number) => (p.high ? upper >= lower : upper <= lower);
  const above = L[at - 1], below = L[at];
  return (above === undefined || ok(look.value(above, a), x)) && (below === undefined || ok(x, look.value(below, a)));
}

/** Last: where the next one's value lies from the one before; null for a tie (either is right). */
export function answer(p: OrderPuzzle, k: number, look: Lookup): Dir | null {
  const a = p.attrs[k]!;
  const l = look.value(p.ids[k]!, a), r = look.value(p.ids[k + 1]!, a);
  return r > l ? "higher" : r < l ? "lower" : null;
}

export function reduce(p: OrderPuzzle, s: OrderState, a: OrderAction, look: Lookup): OrderState {
  if (isOver(p, s)) return s;
  if (p.mode === "sort") {
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
      case "submit":
        return { ...s, tries: [...s.tries, { order: s.order.slice(), off: offsets(s.order.map((id) => look.value(id, p.attrs[0]!)), p.high) }] };
    }
    return s;
  }
  if (p.mode === "line" && a.type === "place") {
    if (!Number.isInteger(a.at) || a.at < 0 || a.at > s.results.length + 1) return s;
    return { ...s, results: [...s.results, fitsAt(p, s, look, a.at)] };
  }
  if (p.mode === "last" && a.type === "guess" && (a.dir === "higher" || a.dir === "lower")) {
    const want = answer(p, s.results.length, look);
    return { ...s, results: [...s.results, want === null || want === a.dir] };
  }
  return s;
}

/** Sort: a right order from `s`: pinned items stay, the rest go in order around them. */
export function sortedFrom(p: OrderPuzzle, s: OrderState, look: Lookup): string[] {
  const pin = pinned(s);
  const v = (id: string) => look.value(id, p.attrs[0]!);
  const rest = s.order.filter((_, i) => !pin[i]).sort((a, b) => (p.high ? v(b) - v(a) : v(a) - v(b)));
  let k = 0;
  return s.order.map((id, i) => (pin[i] ? id : rest[k++]!));
}

/** Line: the first gap the next one belongs in. */
export const rightGap = (p: OrderPuzzle, s: OrderState, look: Lookup): number => {
  for (let at = 0; at <= s.results.length + 1; at++) if (fitsAt(p, s, look, at)) return at;
  return 0;
};

export function generate(d: Dataset, given: Values<Params>, params: Params, rng: Rng): OrderPuzzle {
  const v = effective(params, given);
  const nums = orderable(d).map((a) => a.id);
  const by = nums.filter((a) => v.by.includes(a));
  if (!by.length) throw new Error("pick at least one thing to put them in order of");
  const r = filter(d.items(), v.pool, d.attributes);
  if ("error" in r) throw new Error(`the filter: ${r.error}`);
  const mode = v.mode as Mode;
  const noun = d.noun?.many ?? "items";
  const base = { dataset: d.id, mode, high: v.top !== "low", tries: v.tries, marks: v.marks as Marks, lives: v.lives };
  if (mode === "sort") {
    const attr = rng.pick(by);
    const pool = r.items.filter((it) => typeof it.values[attr] === "number");
    // one per value: equal values would be free marks
    const byValue = new Map<number, DataItem[]>();
    for (const it of pool) { const k = it.values[attr] as number; byValue.set(k, [...(byValue.get(k) ?? []), it]); }
    const values = [...byValue.keys()].sort((a, b) => a - b);
    const label = d.attributes.find((a) => a.id === attr)!.label;
    if (values.length < v.count) throw new Error(`those ${noun} have only ${values.length} different values of ${label}; pick fewer or a wider filter`);
    let chosen: number[];
    if (v.spread === "close") {
      const width = Math.min(values.length, v.count * 3);
      const start = rng.int(values.length - width + 1);
      chosen = rng.shuffle(values.slice(start, start + width)).slice(0, v.count);
    } else chosen = rng.shuffle(values.slice()).slice(0, v.count);
    const items = chosen.map((k) => rng.pick(byValue.get(k)!));
    const val = new Map(items.map((it) => [it.id, it.values[attr] as number]));
    let ids = rng.shuffle(items.map((it) => it.id));
    // never start already in order
    for (let k = 0; k < 10 && offsets(ids.map((id) => val.get(id)!), base.high).every((o) => o === 0); k++) ids = rng.shuffle(ids);
    return { ...base, ids, attrs: [attr] };
  }
  const attr = rng.pick(by);
  // a run on one attribute needs everyone to have it; mixing, every one asked about
  const need = mode === "last" ? by : [attr];
  const pool = r.items.filter((it) => need.every((a) => typeof it.values[a] === "number"));
  if (pool.length < 2) throw new Error(`the filter leaves fewer than 2 ${noun} with these values`);
  const ids = rng.shuffle(pool.map((i) => i.id)).slice(0, v.length);
  const pickAttr = rng.fork("attributes");
  return { ...base, ids, attrs: mode === "last" ? ids.slice(1).map(() => pickAttr.pick(by)) : [attr] };
}

const SQUARE = { right: "🟩", near: "🟨", far: "⬜" } as const;

export function orderDef(data: DataSource): PuzzleDef<OrderPuzzle, OrderState, OrderAction, null, Params> {
  const params = makeParams(data);
  const lookFor = (p: OrderPuzzle): Lookup => {
    const d = data.get(p.dataset);
    if (!d) throw new Error(`the ${p.dataset} dataset's pack isn't loaded`);
    return lookupOf(d);
  };
  const noun = (p: OrderPuzzle) => data.get(p.dataset)?.noun?.many ?? "items";
  const label = (p: OrderPuzzle, a: string) => lookFor(p).attribute(a).label;
  const attrsLabel = (p: OrderPuzzle) => { const used = [...new Set(p.attrs)]; return used.length > 3 ? `${used.length} things, mixed` : used.map((a) => label(p, a)).join(", "); };
  return {
    id: "order",
    name: "in order",
    aliases: ["higher or lower", "the higher lower game", "timeline", "wikitrivia", "sorted", "rank them", "pokémon sort", "pokémon higher or lower"],
    tags: ["ordering", "trivia", "streak"],
    description: "put things in order by a number: sort a handful with tries, place each new one into a growing line, or say whether the next is higher or lower than the last.",
    datasetsOf: (p) => [p.dataset],
    generatorVersion: 1,
    params,
    get presets() {
      const on = (id: string, list: { label: string; params: Record<string, unknown> }[]) => (data.get(id) ? list.map((x) => ({ label: x.label, params: { dataset: id, ...x.params } })) : []);
      return [
        ...on("pokemon", [
          { label: "pokémon sort: 6, 4 tries", params: { mode: "sort" } },
          { label: "pokémon sort, easy: marks say how far", params: { mode: "sort", count: 5, marks: "exact" } },
          { label: "pokémon sort, hard: 8 close together", params: { mode: "sort", count: 8, tries: 5, spread: "close" } },
          { label: "pokémon higher or lower: base stat total", params: { mode: "last", by: ["bst"] } },
          { label: "pokémon higher or lower: any base stat", params: { mode: "last", by: ["hp", "atk", "def", "spa", "spd", "spe"] } },
          { label: "pokémon higher or lower: everything, 3 lives", params: { mode: "last", by: orderable(data.get("pokemon")).map((a) => a.id), lives: 3 } },
          { label: "pokémon timeline: by dex number", params: { mode: "line", by: ["dex"] } },
          { label: "pokémon timeline: by weight", params: { mode: "line", by: ["weight"] } },
        ]),
        ...data.list().filter((d) => d.id !== "pokemon" && orderable(d).length).flatMap((d) => [
          { label: `${d.name}: sort`, params: { dataset: d.id, mode: "sort" } },
          { label: `${d.name}: into a line`, params: { dataset: d.id, mode: "line" } },
          { label: `${d.name}: higher or lower`, params: { dataset: d.id, mode: "last" } },
        ]),
      ];
    },
    daily: { params: {} },
    // a try or an answer, once marked, stands
    irreversible: true,
    generate: (v, rng) => {
      const d = data.get(String(v.dataset));
      if (!d) throw new Error(`the ${v.dataset} dataset's pack isn't loaded`);
      return generate(d, v, params, rng);
    },
    formats: [],
    init: (p) => ({ order: p.mode === "sort" ? p.ids.slice() : [], tries: [], results: [] }),
    reduce: (p, s, a) => reduce(p, s, a, lookFor(p)),
    isSolved,
    isLost: (p, s) => (p.mode === "sort" ? !isSolved(p, s) && s.tries.length >= p.tries : mistakes(s) >= p.lives),
    solve: (p, s) => {
      if (isOver(p, s)) return null;
      const look = lookFor(p);
      if (p.mode === "sort") {
        const order = sortedFrom(p, s, look);
        return { moves: [...(order.every((id, i) => id === s.order[i]) ? [] : [{ type: "order" as const, order }]), { type: "submit" as const }] };
      }
      const moves: OrderAction[] = [];
      let st = s;
      for (let k = s.results.length; k < rounds(p); k++) {
        const m: OrderAction = p.mode === "line" ? { type: "place", at: rightGap(p, st, look) } : { type: "guess", dir: answer(p, k, look) ?? "higher" };
        moves.push(m);
        st = reduce(p, st, m, look);
      }
      return { moves };
    },
    hint: (p, s): Hint<OrderAction> | null => {
      if (isOver(p, s)) return null;
      const look = lookFor(p);
      if (p.mode === "sort") {
        const want = sortedFrom(p, s, look);
        const pin = pinned(s);
        const v = (id: string) => look.value(id, p.attrs[0]!);
        const at = s.order.findIndex((id, i) => !pin[i] && v(id) !== v(want[i]!));
        if (at < 0) return { message: "this order is right: submit it", actions: [{ type: "submit" }] };
        const from = s.order.findIndex((id, i) => !pin[i] && i !== at && v(id) === v(want[at]!));
        return { message: `${look.item(s.order[from]!).name} belongs in place ${at + 1}`, actions: [{ type: "move", from, to: at }] };
      }
      if (p.mode === "line") {
        const L = line(p, s, look);
        const at = rightGap(p, s, look);
        const where = at === 0 ? `above ${look.item(L[0]!).name}` : at === L.length ? `below ${look.item(L[L.length - 1]!).name}` : `between ${look.item(L[at - 1]!).name} and ${look.item(L[at]!).name}`;
        return { message: `it goes ${where}`, actions: [{ type: "place", at }] };
      }
      const k = s.results.length;
      const dir = answer(p, k, look) ?? "higher";
      return { message: `${look.item(p.ids[k + 1]!).name}'s is ${dir}`, actions: [{ type: "guess", dir }] };
    },
    rules: (p) => {
      const n = noun(p);
      if (p.mode === "sort") return [
        `put the ${p.ids.length} ${n} in order of ${attrsLabel(p)}, ${p.high ? "highest" : "lowest"} at the top. equal values may go either way round.`,
        `you have ${p.tries} ${p.tries === 1 ? "try" : "tries"}. each try marks every one: ✓ in the right place${
          p.marks === "place" ? ", ✗ if not."
          : p.marks === "direction" ? ", else an arrow saying whether it belongs higher or lower."
          : p.marks === "exact" ? ", else an arrow and how many places it belongs higher or lower."
          : ", else an arrow saying whether it belongs higher or lower, highlighted when it is just one place off."}`,
        "ones marked ✓ stay put; the others move around them.",
      ];
      const lives = p.lives > 1 ? `you have ${p.lives} lives: the run ends after ${p.lives} wrong answers.` : "the run ends at your first wrong answer.";
      if (p.mode === "line") return [
        `one starts the line, with its ${attrsLabel(p)} shown. each new one goes where it belongs in the line, ${p.high ? "highest" : "lowest"} at the top; equal values may go either side.`,
        "right or wrong, it then joins the line in its true place, its value shown.",
        lives,
        `get through all ${p.ids.length} to clear the run.`,
      ];
      return [
        `two side by side. you see the left one's ${attrsLabel(p)}${new Set(p.attrs).size > 1 ? " (which one changes each round)" : ""}.`,
        "say whether the right one's is higher or lower. if they're equal, either answer is right.",
        "then the right one moves to the left, and a new one comes in.",
        lives,
        `get through all ${p.ids.length} to clear the run.`,
      ];
    },
    describe: (p) => (p.mode === "sort" ? `${p.ids.length} by ${attrsLabel(p)}` : `${p.mode === "line" ? "a line" : "higher or lower"} by ${attrsLabel(p)}${p.lives > 1 ? `, ${p.lives} lives` : ""}`),
    describeAction: (p, a, before) => {
      const look = lookFor(p);
      if (a.type === "move") return `move ${look.item(before.order[a.from]!).name} to place ${a.to + 1}`;
      if (a.type === "order") return "reorder";
      if (a.type === "submit") return "submit";
      const k = before.results.length;
      if (a.type === "place") return `place ${look.item(p.ids[k + 1]!).name} in gap ${a.at + 1}`;
      return `${look.item(p.ids[k + 1]!).name}: ${a.dir} than ${look.item(p.ids[k]!).name}`;
    },
    score: (p, s) => (p.mode === "sort" ? (isSolved(p, s) ? { value: s.tries.length, label: "tries", better: "lower" } : null) : { value: correct(s), label: `${correct(s)} right`, better: "higher" }),
    verdict: (p, s) => {
      if (p.mode === "sort") return null;
      const n = correct(s);
      if (mistakes(s) < p.lives) return `run cleared: ${n} right`;
      return p.lives > 1 ? `out of lives: ${n} right` : `streak of ${n}`;
    },
    shareText: (p, s) => {
      if (p.mode === "sort") {
        const head = `in order, ${attrsLabel(p)}: ${isSolved(p, s) ? s.tries.length : "X"}/${p.tries}`;
        return [head, ...s.tries.map((t) => t.off.map((o) => SQUARE[markOf(o, p.marks).cls]).join(""))].join("\n");
      }
      const lines = [`${p.mode === "line" ? "in order, a line" : "higher or lower"} · ${attrsLabel(p)}`, p.lives > 1 ? `${correct(s)} right, ${p.lives} lives` : `streak ${correct(s)}`];
      if (s.results.length <= 50) {
        const sq = s.results.map((r) => (r ? "🟩" : "🟥"));
        for (let i = 0; i < sq.length; i += 10) lines.push(sq.slice(i, i + 10).join(""));
      }
      if (isSolved(p, s)) lines.push("whole run cleared");
      return lines.join("\n");
    },
  };
}
