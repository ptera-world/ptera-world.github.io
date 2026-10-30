import type { Rng } from "../../core/rng";
import { defineSchema, type Values } from "../../core/schema";
import type { Hint, PuzzleDef } from "../../core/types";
import { normalizeName } from "../../lib/dataset/names";
import { poolField, poolOf } from "../../lib/pokemon/pool";
import type { PokemonDataset, PokemonItem } from "../../lib/pokemon/types";

/**
 * Name them all: name as many pokémon of a pool as you can, typing names from memory. A name
 * counts the moment it is spelled right; giving up or running out of time shows the ones missed.
 */

export interface NameAllPuzzle {
  /** The filter the pool came from, as the player wrote it (or as the round picked it). */
  query: string;
  /** What the pool is, in words, when the round picked it (e.g. "generation 3"). */
  label?: string;
  /** Item ids, in dex order. */
  pool: string[];
  /** 0: untimed. */
  limitMs: number;
  /** How a slot looks before it is named. */
  slots: Slots;
}

export type Slots = "number" | "silhouette" | "blank";

export interface NameAllState {
  /** Ids named, in the order they were named. */
  named: string[];
  /** Given up or out of time: the rest of the pool shows as missed. */
  ended: boolean;
}

/** Naming several at once happens when two pool items share a name (two "Mega Meowstic"). `end`: giving up, or time up. */
export type NameAllAction = { type: "name"; ids: string[] } | { type: "end" };

/** Hint focus: slots by id. */
export interface NameAllFocus {
  ids: string[];
}

export const ROUNDS = [
  { value: "filter", label: "the filter as written" },
  { value: "gen", label: "a random generation of it" },
  { value: "type", label: "a random type of it" },
  { value: "any", label: "a random generation or type of it" },
] as const;

export function makeParams(dataset: () => PokemonDataset | undefined) {
  return defineSchema({
    pool: { ...poolField(dataset), default: "form:default gen:1" },
    round: {
      type: "enum", label: "round", default: "filter", options: ROUNDS,
      description: "a random round picks a generation or a type of the filtered pokémon, a different one each game",
    },
    pace: {
      type: "int", label: "seconds per pokémon", default: 6, min: 0, max: 60,
      description: "the time limit is this times the number of pokémon, rounded up to whole minutes. 0: untimed",
    },
    slots: {
      type: "enum", label: "unnamed pokémon show", default: "number",
      options: [
        { value: "number", label: "their dex number" },
        { value: "silhouette", label: "their silhouette" },
        { value: "blank", label: "nothing" },
      ],
    },
  });
}
export type NameAllParams = ReturnType<typeof makeParams>;

/** Dex order: species number, then forms by PokeAPI id. */
export const dexOrder = (a: PokemonItem, b: PokemonItem): number => a.species - b.species || a.pid - b.pid;

const primaryType = (it: PokemonItem): string | null => {
  const t = it.values.type;
  return Array.isArray(t) && t.length ? String(t[0]) : null;
};

export function limitFor(count: number, pace: number): number {
  return pace > 0 ? Math.ceil((count * pace) / 60) * 60_000 : 0;
}

export function generate(d: PokemonDataset, v: Values<NameAllParams>, rng: Rng): NameAllPuzzle {
  const base = poolOf(d, v.pool);
  let items = base, label: string | undefined, query = v.pool;
  const round = v.round === "any" ? (rng.bool() ? "gen" : "type") : v.round;
  if (round === "gen" || round === "type") {
    const attr = d.attributes.find((a) => a.id === round)!;
    // only kinds that leave at least a few to name make a round
    const of = (it: PokemonItem) => (round === "gen" ? [String(it.values.gen)] : (it.values.type as string[] | null) ?? []);
    const counts = new Map<string, number>();
    for (const it of base) for (const x of of(it)) counts.set(x, (counts.get(x) ?? 0) + 1);
    const options = (attr.values ?? []).map((x) => x.value).filter((x) => (counts.get(x) ?? 0) >= 5);
    if (!options.length) throw new Error(`the filter leaves no ${round === "gen" ? "generation" : "type"} with at least 5 pokémon`);
    const pick = rng.pick(options);
    items = base.filter((it) => of(it).includes(pick));
    const name = attr.values!.find((x) => x.value === pick)!.label;
    label = round === "gen" ? name : `${name} types`;
    query = `${v.pool} ${round}:${pick}`.trim();
  }
  const pool = items.slice().sort(dexOrder).map((it) => it.id);
  return { query, ...(label ? { label } : {}), pool, limitMs: limitFor(pool.length, v.pace), slots: v.slots as Slots };
}

export const isSolved = (p: NameAllPuzzle, s: NameAllState): boolean => s.named.length === p.pool.length;
export const isOver = (p: NameAllPuzzle, s: NameAllState): boolean => s.ended || isSolved(p, s);

/** Pool ids not named yet, in dex order. */
export function missed(p: NameAllPuzzle, s: NameAllState): string[] {
  const n = new Set(s.named);
  return p.pool.filter((id) => !n.has(id));
}

export function reduce(p: NameAllPuzzle, s: NameAllState, a: NameAllAction): NameAllState {
  if (isOver(p, s)) return s;
  if (a.type === "end") return { ...s, ended: true };
  if (a.type !== "name") return s;
  const done = new Set(s.named);
  const inPool = new Set(p.pool);
  const fresh = [...new Set(a.ids)].filter((id) => inPool.has(id) && !done.has(id));
  return fresh.length ? { ...s, named: [...s.named, ...fresh] } : s;
}

/** Normalized name (and aliases) → pool items with it. */
export function nameIndex(items: readonly PokemonItem[]): Map<string, PokemonItem[]> {
  const out = new Map<string, PokemonItem[]>();
  for (const it of items) {
    for (const k of new Set([it.name, ...(it.aliases ?? [])].map(normalizeName))) {
      if (!k) continue;
      const list = out.get(k) ?? [];
      list.push(it);
      out.set(k, list);
    }
  }
  return out;
}

/**
 * What typing `text` does: `name` lists the unnamed pool items it names exactly; `known` the
 * already named ones it names; `outside` is true when it names a pokémon not in the pool.
 * `longer` is true when it is the start of the name of an unnamed pool item other than itself,
 * so the player may still be typing that one (Mew on the way to Mewtwo).
 */
export interface Typed {
  name: string[];
  known: string[];
  outside: boolean;
  longer: boolean;
}

export function readTyped(text: string, index: Map<string, PokemonItem[]>, all: Map<string, PokemonItem[]>, done: ReadonlySet<string>): Typed {
  const q = normalizeName(text);
  if (!q) return { name: [], known: [], outside: false, longer: false };
  const hits = index.get(q) ?? [];
  let longer = false;
  for (const [k, list] of index) if (k.length > q.length && k.startsWith(q) && list.some((it) => !done.has(it.id))) { longer = true; break; }
  return {
    name: hits.filter((it) => !done.has(it.id)).map((it) => it.id),
    known: hits.filter((it) => done.has(it.id)).map((it) => it.id),
    outside: !hits.length && all.has(q),
    longer,
  };
}

/** Groups of the board: by generation, by first type, or one group. */
export type Grouping = "gen" | "type" | "none";

export function groups(items: readonly PokemonItem[], by: Grouping, d: PokemonDataset): { key: string; label: string; items: PokemonItem[] }[] {
  if (by === "none") return [{ key: "all", label: "", items: items.slice() }];
  const attr = d.attributes.find((a) => a.id === by)!;
  const keyOf = (it: PokemonItem) => (by === "gen" ? String(it.values.gen ?? "") : primaryType(it) ?? "");
  const order = (attr.values ?? []).map((v) => v.value);
  const map = new Map<string, PokemonItem[]>();
  for (const it of items) {
    const k = keyOf(it);
    map.set(k, [...(map.get(k) ?? []), it]);
  }
  return [...map.keys()].sort((a, b) => order.indexOf(a) - order.indexOf(b)).map((k) => {
    const v = attr.values?.find((x) => x.value === k)?.label ?? "other";
    return { key: k, label: v, items: map.get(k)! };
  });
}

export function formatClock(ms: number): string {
  const t = Math.max(0, Math.ceil(ms / 1000));
  return `${Math.floor(t / 60)}:${String(t % 60).padStart(2, "0")}`;
}

export function makeDef(dataset: () => PokemonDataset | undefined): PuzzleDef<NameAllPuzzle, NameAllState, NameAllAction, null, NameAllParams> {
  const need = (): PokemonDataset => {
    const d = dataset();
    if (!d) throw new Error("the pokémon data pack isn't loaded");
    return d;
  };
  const byId = new WeakMap<PokemonDataset, Map<string, PokemonItem>>();
  const item = (id: string): PokemonItem | undefined => {
    const d = dataset();
    if (!d) return undefined;
    let m = byId.get(d);
    if (!m) byId.set(d, m = new Map(d.items().map((it) => [it.id, it])));
    return m.get(id);
  };
  const what = (p: NameAllPuzzle) => p.label ?? p.query ?? "pokémon";
  return {
    id: "name-them-all",
    name: "name them all",
    aliases: ["sporcle pokémon", "name all pokémon", "pokémon quiz", "pokemon recall"],
    tags: ["pokémon", "quiz", "memory", "timed"],
    description: "type as many pokémon as you can remember before time runs out. a name counts as soon as it is spelled right.",
    datasets: ["pokemon"],
    generatorVersion: 1,
    params: makeParams(dataset),
    presets: [
      { label: "generation 1 (151)", params: {} },
      { label: "a random generation", params: { pool: "form:default", round: "gen" } },
      { label: "a random type", params: { pool: "form:default", round: "type" } },
      { label: "every species", params: { pool: "form:default" } },
      { label: "every species, untimed", params: { pool: "form:default", pace: 0 } },
      { label: "generation 1 by silhouette", params: { slots: "silhouette" } },
    ],
    daily: { params: { pool: "form:default", round: "any" } },
    generate: (v, rng) => generate(need(), v, rng),
    formats: [],
    init: () => ({ named: [], ended: false }),
    reduce,
    isSolved,
    // giving up and time up end the game with a score (a loss), not a reveal; the board shows the missed ones
    isLost: (p, s) => s.ended && !isSolved(p, s),
    // a quiz: a name seen counted, or the missed ones seen, can't be taken back
    irreversible: true,
    hint: (p, s) => {
      if (isOver(p, s)) return null;
      const id = missed(p, s)[0];
      const it = id ? item(id) : undefined;
      if (!id || !it) return null;
      const name = it.name;
      const half = name.slice(0, Math.max(2, Math.ceil(name.length / 2)));
      const focus: NameAllFocus = { ids: [id] };
      const at = `#${String(it.species).padStart(4, "0")}`;
      return {
        message: `${at} starts with ${name[0]}`, focus, level: 1,
        more: { message: `${at} starts with ${half}…`, focus, level: 2 },
      } satisfies Hint<NameAllAction>;
    },
    describeAction: (_p, a) => a.type === "end" ? "end" : `name ${a.ids.map((id) => item(id)?.name ?? id).join(", ")}`,
    describe: (p) => `${what(p)}: ${p.pool.length}${p.limitMs ? `, ${formatClock(p.limitMs)}` : ""}`,
    rules: (p) => [
      `name all ${p.pool.length} pokémon (${what(p)}). type a name; it counts as soon as it is spelled right.`,
      "capitals, accents, spaces and punctuation don't matter: farfetchd is Farfetch’d, nidoran f is Nidoran♀.",
      p.limitMs ? `you have ${formatClock(p.limitMs)}. when time is up, the ones you missed are shown.` : "there is no time limit. give up to see the ones you missed.",
    ],
    score: (p, s) => ({ value: s.named.length, label: `${s.named.length}/${p.pool.length}`, better: "higher" }),
    shareText: (p, s) => {
      const lines = [`name them all · ${what(p)}`, `${s.named.length}/${p.pool.length}${p.limitMs ? ` · ${formatClock(p.limitMs)} limit` : ""}`];
      const d = dataset();
      if (d) {
        const named = new Set(s.named);
        const gens = groups(p.pool.map(item).filter((x): x is PokemonItem => !!x), "gen", d);
        if (gens.length > 1) for (const g of gens) {
          const n = g.items.filter((it) => named.has(it.id)).length;
          const filled = Math.round((n / g.items.length) * 10);
          lines.push(`${"🟩".repeat(filled)}${"⬛".repeat(10 - filled)} ${g.label}: ${n}/${g.items.length}`);
        }
      }
      return lines.join("\n");
    },
  };
}
