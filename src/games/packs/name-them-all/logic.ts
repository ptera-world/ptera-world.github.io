import type { Rng } from "../../core/rng";
import { defineSchema, type FieldOption, type Values } from "../../core/schema";
import type { DataAttribute, DataItem, Dataset, Hint, Media, PuzzleDef } from "../../core/types";
import { formatValue, rank } from "../../lib/dataset/compare";
import { normalizeName } from "../../lib/dataset/names";
import { filter } from "../../lib/dataset/query";

/**
 * Name them all: name as many items of a pool as you can (every pokémon of a generation, every
 * chess opening that isn't a variation…), typing names from memory. A name counts the moment it is
 * spelled right; giving up or running out of time shows the ones missed.
 */

/** The datasets the game can be played on, looked up when needed (packs load in any order). */
export interface DataSource {
  get(id: string): Dataset | undefined;
  list(): readonly Dataset[];
}

/** A round has at least this many to name (fewer is hardly a quiz). */
export const MIN_POOL = 5;
/**
 * And at most this many: the board draws a slot for each and the puzzle lists each. Above the
 * largest pool the game had before it took a dataset (every pokémon form, 1351).
 */
export const MAX_POOL = 2000;

export interface NameAllPuzzle {
  /** Absent in games saved before the game took a dataset: pokémon, the only one it had then. */
  dataset?: string;
  /** The filter the pool came from, as the player wrote it (or as the round narrowed it). */
  query: string;
  /** What the pool is, in words, when a round picked it (e.g. "generation: gen 3"). */
  label?: string;
  /** Item ids, in the order of the dataset's first ordered attribute (see orderAttr). */
  pool: string[];
  /** 0: untimed. */
  limitMs: number;
  /** How a slot looks before it is named: "blank", "silhouette", or an attribute id whose value it shows. */
  slots: string;
}

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

/** The dataset a puzzle is on (see NameAllPuzzle.dataset). */
export const datasetOf = (p: NameAllPuzzle): string => p.dataset ?? "pokemon";
/** What unnamed slots show; games saved before the game took a dataset said "number" for the pokémon dex number. */
export const slotsOf = (p: NameAllPuzzle): string => (p.dataset === undefined && p.slots === "number" ? "dex" : p.slots);

// --- what a dataset offers the game ---

const listed = (a: DataAttribute): boolean => !!a.values?.length;
/** Attributes in the order to offer them: the dataset's featured ones first, then the rest as listed. */
function byFeatured(d: Dataset): DataAttribute[] {
  const f = d.featured ?? [];
  const rankOf = (a: DataAttribute) => { const i = f.indexOf(a.id); return i < 0 ? f.length : i; };
  return d.attributes.slice().sort((a, b) => rankOf(a) - rankOf(b));
}

/** Attributes a round can narrow a pool by, one value of: the ones with a list of values (generation, type, color…). */
export const roundable = (d: Dataset | undefined): DataAttribute[] =>
  d ? byFeatured(d).filter((a) => (a.kind === "ordinal" || a.kind === "category" || a.kind === "set") && listed(a)) : [];

/** The attribute pools are put in order of: the first the dataset lists that has an order (pokémon: dex number). */
export const orderAttr = (d: Dataset): DataAttribute | undefined => d.attributes.find((a) => a.kind === "number" || (a.kind === "ordinal" && listed(a)));

/** Attributes an unnamed slot can show the value of; the pool's order first. */
export function slotAttrs(d: Dataset | undefined): DataAttribute[] {
  if (!d) return [];
  const first = orderAttr(d);
  const rest = byFeatured(d).filter((a) => a !== first && a.kind !== "text" && a.kind !== "bool");
  return (first ? [first, ...rest] : rest).filter((a) => a.id !== "blank" && a.id !== "silhouette");
}

/** The picture a slot shows: a small one (a sprite) rather than a large one, if the dataset has any. */
export function pictureOf(d: Dataset | undefined): Media | undefined {
  const ms = Object.values(d?.media ?? {}).filter((m) => m.type === "image");
  return ms.find((m) => m.pixel) ?? ms[0];
}

/** Normalized name and aliases: what typing is matched against. */
export function nameKeys(it: DataItem): string[] {
  return [...new Set([it.name, ...(it.aliases ?? [])].map(normalizeName))].filter(Boolean);
}
// a name with a plain letter or digit keeps it when normalized: the quick test, enough for nearly every item
const nameable = (it: DataItem): boolean => /[A-Za-z0-9]/.test(it.name) || nameKeys(it).length > 0;

/** An item's values of an attribute, as strings (none when it has nothing recorded). */
function valuesOf(it: DataItem, a: DataAttribute): string[] {
  const v = it.values[a.id];
  return v === null || v === undefined ? [] : Array.isArray(v) ? (v as string[]) : [String(v)];
}

/** Each value of `a` with how many of `items` have it, in the attribute's order. */
function counts(items: readonly DataItem[], a: DataAttribute): { value: string; n: number }[] {
  const c = new Map<string, number>();
  for (const it of items) for (const x of valuesOf(it, a)) c.set(x, (c.get(x) ?? 0) + 1);
  return (a.values ?? []).map((x) => ({ value: x.value, n: c.get(x.value) ?? 0 }));
}
const fits = (n: number): boolean => n >= MIN_POOL && n <= MAX_POOL;

/** The items of a filter that can be named, or the filter's error. */
function poolOf(d: Dataset, query: string): { items: DataItem[] } | { error: string } {
  const r = filter(d.items(), query, d.attributes);
  return "error" in r ? r : { items: r.items.filter(nameable) };
}

/** A setup that makes a game on a dataset: a pool, and the attributes a round narrows it by (none: as written). */
export interface Setup { pool: string; round: string[] }

const setups = new WeakMap<Dataset, Setup | null>();
/**
 * What a game on `d` starts from, or null if none fits on the board: the smallest of the dataset's
 * pools that does (a quiz you can finish), else the first pool some round narrows to a size that
 * fits, with those rounds (the featured ones, if any of them fit).
 */
export function setupOf(d: Dataset): Setup | null {
  if (setups.has(d)) return setups.get(d)!;
  const pools = d.pools?.length ? d.pools : [{ label: "everything", query: "" }];
  const sized = pools.flatMap((p) => { const r = poolOf(d, p.query); return "error" in r ? [] : [{ query: p.query, items: r.items }]; });
  let best: Setup | null = null;
  let n = Infinity;
  for (const p of sized) if (fits(p.items.length) && p.items.length < n) { n = p.items.length; best = { pool: p.query, round: [] }; }
  if (!best) {
    const featured = new Set(d.featured ?? []);
    for (const p of sized) {
      const ok = roundable(d).filter((a) => counts(p.items, a).some((c) => fits(c.n)));
      const round = ok.some((a) => featured.has(a.id)) ? ok.filter((a) => featured.has(a.id)) : ok;
      if (round.length) { best = { pool: p.query, round: round.map((a) => a.id) }; break; }
    }
  }
  setups.set(d, best);
  return best;
}

/** Datasets a game can be played on: ones with a setup that fits (see setupOf). */
export const playable = (data: DataSource): Dataset[] => data.list().filter((d) => setupOf(d) !== null);

export function makeParams(data: DataSource) {
  const ds = (v: Record<string, unknown>) => data.get(String(v.dataset));
  const noun = (v: Record<string, unknown>) => ds(v)?.noun?.many ?? "items";
  return defineSchema({
    dataset: {
      type: "enum", label: "dataset",
      default: () => (data.get("pokemon") && setupOf(data.get("pokemon")!) ? "pokemon" : playable(data)[0]?.id ?? ""),
      options: () => playable(data).map((d) => ({ value: d.id, label: d.name })),
    },
    pool: {
      type: "string", label: "which ones", placeholder: "a filter; empty: everything",
      default: (v) => { const d = ds(v); return d ? setupOf(d)?.pool ?? "" : ""; },
      filterOf: (v) => ds(v),
      check: (q, v) => {
        const d = ds(v);
        if (!d) return "that dataset's pack isn't loaded";
        const r = poolOf(d, q);
        if ("error" in r) return r.error;
        return `${r.items.length} ${noun(v)}${r.items.length > MAX_POOL ? `: more than the board holds (${MAX_POOL}) unless a round narrows it` : ""}`;
      },
    },
    round: {
      type: "set", label: "narrow to a random one of",
      default: (v) => { const d = ds(v); return d ? setupOf(d)?.round ?? [] : []; },
      options: (v): FieldOption[] => roundable(ds(v)).map((a) => ({ value: a.id, label: a.label })),
      description: `each game narrows the filtered ones to one value of this, picked at random (a random generation, a random type…), one that leaves at least ${MIN_POOL} and at most ${MAX_POOL}. several: one of them each game. none: the filter as written`,
    },
    pace: {
      type: "int", label: "seconds each", default: 6, min: 0, max: 60,
      description: "the time limit is this times the number to name, rounded up to whole minutes. 0: untimed",
    },
    slots: {
      type: "enum", label: "unnamed ones show",
      default: (v) => { const d = ds(v); return (d && slotAttrs(d)[0]?.id) || "blank"; },
      options: (v): FieldOption[] => {
        const d = ds(v);
        return [
          ...slotAttrs(d).map((a) => ({ value: a.id, label: `their ${a.label}` })),
          ...(pictureOf(d) ? [{ value: "silhouette", label: "their silhouette" }] : []),
          { value: "blank", label: "nothing" },
        ];
      },
    },
  });
}
export type NameAllParams = ReturnType<typeof makeParams>;

export function limitFor(count: number, pace: number): number {
  return pace > 0 ? Math.ceil((count * pace) / 60) * 60_000 : 0;
}

/** Pool items in the order of the dataset's first ordered attribute (unrecorded last), else as the dataset lists them. */
export function inOrder<T extends DataItem>(d: Dataset, items: readonly T[]): T[] {
  const a = orderAttr(d);
  if (!a) return items.slice();
  const key = (it: T): number => {
    const v = it.values[a.id] ?? null;
    const k = v === null ? -1 : a.kind === "number" ? Number(v) : rank(a, v);
    return v === null || !Number.isFinite(k) || (a.kind === "ordinal" && k < 0) ? Infinity : k;
  };
  const keys = new Map(items.map((it) => [it, key(it)]));
  // sort is stable: items with equal keys keep the dataset's order
  return items.slice().sort((x, y) => { const kx = keys.get(x)!, ky = keys.get(y)!; return kx === ky ? 0 : kx < ky ? -1 : 1; });
}

export function generate(d: Dataset, v: Values<NameAllParams>, rng: Rng): NameAllPuzzle {
  const noun = d.noun?.many ?? "items";
  const r = poolOf(d, v.pool);
  if ("error" in r) throw new Error(`the filter: ${r.error}`);
  const base = r.items;
  let items = base, label: string | undefined, query = v.pool;
  const by = roundable(d).filter((a) => v.round.includes(a.id));
  if (by.length) {
    // only values that leave a quiz's worth make a round
    const options = by.map((a) => ({ a, values: counts(base, a).filter((c) => fits(c.n)).map((c) => c.value) })).filter((o) => o.values.length);
    if (!options.length) throw new Error(`the filter leaves no ${by.map((a) => a.label).join(" or ")} with at least ${MIN_POOL} and at most ${MAX_POOL} ${noun}`);
    const { a, values } = rng.pick(options);
    const pick = rng.pick(values);
    items = base.filter((it) => valuesOf(it, a).includes(pick));
    label = `${a.label}: ${formatValue(a, pick)}`;
    query = `${v.pool} ${a.id}:${pick}`.trim();
  } else {
    if (!items.length) throw new Error(`the filter leaves no ${noun} to name`);
    if (items.length > MAX_POOL) throw new Error(`the filter leaves ${items.length} ${noun}; the board holds at most ${MAX_POOL}: narrow it, or narrow each game to a random value of something`);
  }
  const pool = inOrder(d, items).map((it) => it.id);
  const slots = v.slots === "silhouette" && !pictureOf(d) ? "blank" : v.slots;
  return { dataset: d.id, query, ...(label ? { label } : {}), pool, limitMs: limitFor(pool.length, v.pace), slots };
}

export const isSolved = (p: NameAllPuzzle, s: NameAllState): boolean => s.named.length === p.pool.length;
export const isOver = (p: NameAllPuzzle, s: NameAllState): boolean => s.ended || isSolved(p, s);

/** Pool ids not named yet, in pool order. */
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

/** Normalized name (and aliases) → items with it. */
export function nameIndex<T extends DataItem>(items: readonly T[]): Map<string, T[]> {
  const out = new Map<string, T[]>();
  for (const it of items) {
    for (const k of nameKeys(it)) {
      const list = out.get(k);
      if (list) list.push(it);
      else out.set(k, [it]);
    }
  }
  return out;
}

/**
 * What typing `text` does: `name` lists the unnamed pool items it names exactly; `known` the
 * already named ones it names; `outside` is true when it names an item of the dataset not in the
 * pool. `longer` is true when it is the start of the name of an unnamed pool item other than
 * itself, so the player may still be typing that one (Mew on the way to Mewtwo).
 */
export interface Typed {
  name: string[];
  known: string[];
  outside: boolean;
  longer: boolean;
}

export function readTyped(text: string, index: Map<string, DataItem[]>, all: Map<string, DataItem[]>, done: ReadonlySet<string>): Typed {
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

/**
 * Groups of the board:
 * - one: by the first attribute (featured first) each item has one listed value of (pokémon: generation)
 * - first: by the first value of the first ordered list each item has (pokémon: first type)
 * - none: one group
 */
export type Grouping = "one" | "first" | "none";

export function groupAttr(d: Dataset, by: Grouping): DataAttribute | undefined {
  if (by === "none") return undefined;
  return roundable(d).find((a) => (by === "one" ? a.kind !== "set" : a.kind === "set" && a.ordered));
}

export function groups<T extends DataItem>(items: readonly T[], by: Grouping, d: Dataset): { key: string; label: string; items: T[] }[] {
  const attr = groupAttr(d, by);
  if (!attr) return [{ key: "all", label: "", items: items.slice() }];
  const map = new Map<string, T[]>();
  for (const it of items) {
    const k = valuesOf(it, attr)[0] ?? "";
    const list = map.get(k);
    if (list) list.push(it);
    else map.set(k, [it]);
  }
  const order = (k: string) => { const i = rank(attr, k); return i < 0 ? Infinity : i; };
  return [...map.keys()].sort((a, b) => order(a) - order(b)).map((k) => ({
    key: k, label: attr.values?.find((x) => x.value === k)?.label ?? "other", items: map.get(k)!,
  }));
}

export function formatClock(ms: number): string {
  const t = Math.max(0, Math.ceil(ms / 1000));
  return `${Math.floor(t / 60)}:${String(t % 60).padStart(2, "0")}`;
}

/** Everything the game reads from a dataset, by item id. */
export interface Lookup {
  d: Dataset;
  item(id: string): DataItem | undefined;
}
const lookups = new WeakMap<Dataset, Lookup>();
export function lookupOf(d: Dataset): Lookup {
  let l = lookups.get(d);
  if (!l) {
    const byId = new Map(d.items().map((it) => [it.id, it]));
    lookups.set(d, l = { d, item: (id) => byId.get(id) });
  }
  return l;
}

/** What an unnamed slot shows (its attribute value), or "" when it shows none. */
export function slotText(p: NameAllPuzzle, d: Dataset, it: DataItem): string {
  const a = d.attributes.find((x) => x.id === slotsOf(p));
  return a ? formatValue(a, it.values[a.id] ?? null) : "";
}

/** A slot in words, for hints and screen readers: what it shows ("dex number 2"), else its place ("no. 2"). */
export function slotName(p: NameAllPuzzle, d: Dataset, it: DataItem): string {
  const a = d.attributes.find((x) => x.id === slotsOf(p));
  return a ? `${a.label} ${formatValue(a, it.values[a.id] ?? null)}` : `no. ${p.pool.indexOf(it.id) + 1}`;
}

/** Up to two names of the pool whose typing differs from their spelling, as examples ("farfetchd is Farfetch’d"). */
function examples(items: readonly DataItem[]): string[] {
  const out: string[] = [];
  for (const it of items) {
    if (out.length >= 2) break;
    if (/[^A-Za-z0-9 ]/.test(it.name) && normalizeName(it.name)) out.push(`${normalizeName(it.name)} is ${it.name}`);
  }
  return out;
}

/** The share text has a line per group only for this many groups or fewer. */
const SHARE_GROUPS = 12;

export function makeDef(data: DataSource): PuzzleDef<NameAllPuzzle, NameAllState, NameAllAction, null, NameAllParams> {
  const params = makeParams(data);
  const dataFor = (p: NameAllPuzzle): Dataset | undefined => data.get(datasetOf(p));
  const item = (p: NameAllPuzzle, id: string): DataItem | undefined => { const d = dataFor(p); return d ? lookupOf(d).item(id) : undefined; };
  const noun = (p: NameAllPuzzle, n: number) => { const no = dataFor(p)?.noun; return n === 1 ? no?.one ?? "item" : no?.many ?? "items"; };
  const what = (p: NameAllPuzzle) => p.label ?? (p.query || `every ${noun(p, 1)}`);
  return {
    id: "name-them-all",
    name: "name them all",
    aliases: ["sporcle pokémon", "name all pokémon", "pokémon quiz", "pokemon recall"],
    tags: ["quiz", "memory", "timed"],
    description: "name every one of a set (every pokémon of a generation, every chess opening…) from memory before time runs out. a name counts as soon as it is spelled right.",
    datasetsOf: (p) => [datasetOf(p)],
    // 2: the dataset became a setting and rounds a set of attributes
    generatorVersion: 2,
    params,
    get presets() {
      const pokemon = data.get("pokemon");
      const on = pokemon && setupOf(pokemon) ? [
        { label: "generation 1 (151)", params: {} },
        { label: "a random generation", params: { pool: "form:default", round: ["gen"] } },
        { label: "a random type", params: { pool: "form:default", round: ["type"] } },
        { label: "every species", params: { pool: "form:default" } },
        { label: "every species, untimed", params: { pool: "form:default", pace: 0 } },
        { label: "generation 1 by silhouette", params: { slots: "silhouette" } },
      ].map((x) => ({ label: x.label, params: { dataset: "pokemon", ...x.params } })) : [];
      return [
        ...on,
        ...playable(data).filter((d) => d.id !== "pokemon").map((d) => {
          const s = setupOf(d)!;
          const pool = d.pools?.find((x) => x.query === s.pool)?.label ?? (s.pool || "everything");
          const round = s.round.length ? `, a random ${s.round.map((id) => d.attributes.find((a) => a.id === id)!.label).join(" or ")}` : "";
          return { label: `${d.name}: ${pool}${round}`, params: { dataset: d.id } };
        }),
      ];
    },
    get daily() {
      const pokemon = data.get("pokemon");
      return { params: pokemon && setupOf(pokemon) ? { dataset: "pokemon", pool: "form:default", round: ["gen", "type"] } : {} };
    },
    generate: (v, rng) => {
      const d = data.get(String(v.dataset));
      if (!d) throw new Error(v.dataset ? `the ${v.dataset} dataset's pack isn't loaded` : "no dataset this game can be played on is loaded");
      return generate(d, v, rng);
    },
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
      const d = dataFor(p);
      const id = missed(p, s)[0];
      const it = id ? item(p, id) : undefined;
      if (!d || !id || !it) return null;
      const name = it.name;
      const half = name.slice(0, Math.max(2, Math.ceil(name.length / 2)));
      const focus: NameAllFocus = { ids: [id] };
      const at = slotName(p, d, it);
      return {
        message: `${at} starts with ${name[0]}`, focus, level: 1,
        more: { message: `${at} starts with ${half}…`, focus, level: 2 },
      } satisfies Hint<NameAllAction>;
    },
    describeAction: (p, a) => a.type === "end" ? "end" : `name ${a.ids.map((id) => item(p, id)?.name ?? id).join(", ")}`,
    describe: (p) => `${what(p)}: ${p.pool.length}${p.limitMs ? `, ${formatClock(p.limitMs)}` : ""}`,
    rules: (p) => {
      const ex = examples(p.pool.map((id) => item(p, id)).filter((x): x is DataItem => !!x));
      return [
        `name all ${p.pool.length} ${noun(p, p.pool.length)} (${what(p)}). type a name; it counts as soon as it is spelled right.`,
        `capitals, accents, spaces and punctuation don't matter${ex.length ? `: ${ex.join(", ")}` : ""}.`,
        p.limitMs ? `you have ${formatClock(p.limitMs)}. when time is up, the ones you missed are shown.` : "there is no time limit. give up to see the ones you missed.",
      ];
    },
    score: (p, s) => ({ value: s.named.length, label: `${s.named.length}/${p.pool.length}`, better: "higher" }),
    shareText: (p, s) => {
      const lines = [`name them all · ${what(p)}`, `${s.named.length}/${p.pool.length}${p.limitMs ? ` · ${formatClock(p.limitMs)} limit` : ""}`];
      const d = dataFor(p);
      if (d) {
        const named = new Set(s.named);
        const gs = groups(p.pool.map((id) => item(p, id)).filter((x): x is DataItem => !!x), "one", d);
        if (gs.length > 1 && gs.length <= SHARE_GROUPS) for (const g of gs) {
          const n = g.items.filter((it) => named.has(it.id)).length;
          const filled = Math.round((n / g.items.length) * 10);
          lines.push(`${"🟩".repeat(filled)}${"⬛".repeat(10 - filled)} ${g.label}: ${n}/${g.items.length}`);
        }
      }
      return lines.join("\n");
    },
  };
}
