import type { Rng } from "../../core/rng";
import { defineSchema, effective, type FieldOption, type Values } from "../../core/schema";
import type { DataItem, Dataset, Hint, Media, PuzzleDef } from "../../core/types";
import { filter } from "../../lib/dataset/query";

/** The datasets the game can be played on, looked up when needed (packs load in any order). */
export interface DataSource {
  get(id: string): Dataset | undefined;
  list(): readonly Dataset[];
}

/** A dataset's variant pictures: media that vary another (a shiny sprite varies the sprite). */
export const variantsOf = (d: Dataset | undefined): [string, Media][] => Object.entries(d?.media ?? {}).filter(([, m]) => m.type === "image" && !!m.variantOf && !!d?.media?.[m.variantOf]);

/** Below this the two sprites look the same at any size people play at (checked by eye on a sheet of the lowest). */
export const FINDABLE = 2;

export const DIFFICULTY = { easy: 0.12, medium: 0.45, hard: 0.75, subtle: 0.95 } as const;

export const makeParams = (data: DataSource) => {
  const ds = (v: Record<string, unknown>) => data.get(String(v.dataset));
  const noun = (v: Record<string, unknown>) => ds(v)?.noun?.many ?? "items";
  return defineSchema({
  dataset: {
    type: "enum", label: "dataset",
    default: () => (data.get("pokemon") ? "pokemon" : data.list().find((d) => variantsOf(d).length)?.id ?? ""),
    options: () => data.list().filter((d) => variantsOf(d).length).map((d) => ({ value: d.id, label: d.name })),
  },
  variant: {
    type: "enum", label: "the odd one is shown by its", default: (v) => variantsOf(ds(v))[0]?.[0] ?? "",
    options: (v): FieldOption[] => variantsOf(ds(v)).map(([id, m]) => ({ value: id, label: m.label })),
  },
  pool: {
    type: "string", label: "which ones", default: (v) => ds(v)?.pools?.[0]?.query ?? "", placeholder: "a filter; empty: everything",
    filterOf: (v) => ds(v),
    check: (q, v) => {
      const d = ds(v);
      if (!d) return "that dataset's pack isn't loaded";
      const r = filter(d.items(), q, d.attributes);
      return "error" in r ? r.error : `${r.items.length} ${noun(v)}`;
    },
  },
  grid: {
    type: "enum", label: "grid", default: "same",
    options: (v): FieldOption[] => [
      { value: "same", label: `all the same one`, description: "spot the one that looks off" },
      { value: "mixed", label: `different ${noun(v)}`, description: "you need to know how each one normally looks" },
    ],
  },
  rounds: { type: "int", label: "rounds", default: 10, min: 1, max: 30 },
  difficulty: {
    type: "enum", label: "how different the odd one looks", default: "ramp",
    options: [
      { value: "ramp", label: "obvious at first, subtler each round" },
      { value: "easy", label: "obvious" },
      { value: "medium", label: "noticeable" },
      { value: "hard", label: "subtle" },
      { value: "subtle", label: "very subtle" },
    ],
  },
  start: { type: "int", label: "grid size in the first round", default: 3, min: 2, max: 7, description: "cells per side" },
  end: { type: "int", label: "grid size in the last round", default: 5, min: 2, max: 7, description: "cells per side; rounds in between grow evenly" },
  mistakes: { type: "int", label: "mistakes allowed", default: 2, min: 0, max: 9, description: "one more ends the game" },
  time: { type: "int", label: "seconds per round", default: 0, min: 0, max: 60, description: "0: no limit. running out counts as a mistake" },
  mirror: { type: "bool", label: "some face the other way", default: false, description: "so the odd one can't be spotted by lining cells up" },
  });
};

export type OddParams = ReturnType<typeof makeParams>;

export interface OddRound {
  /** Item per cell, row-major; a round of one item lists it once. */
  ids: string[];
  /** Cells per side. */
  size: number;
  /** The odd cell. */
  odd: number;
  /** Cells drawn mirrored. */
  flips: number[];
}

export interface OddPuzzle {
  dataset: string;
  /** Media ids: the odd one's picture, and the plain one it varies. */
  variant: string;
  plain: string;
  rounds: OddRound[];
  mistakes: number;
  /** Seconds per round, 0 for no limit. */
  time: number;
  grid: "same" | "mixed";
}

export interface RoundPlay {
  /** Cells picked that weren't the odd one, in order. */
  wrong: number[];
  found?: true;
  timedOut?: true;
}

export interface OddState {
  /** Rounds reached; the last is the one being played unless the game is over. */
  rounds: RoundPlay[];
}

export type OddAction = { type: "pick"; cell: number } | { type: "timeout" };

export interface OddInteraction {
  cursor: number;
}

export interface OddFocus {
  cells: number[];
}

export const cellCount = (r: OddRound): number => r.size * r.size;
export const idAt = (r: OddRound, cell: number): string => r.ids[r.ids.length === 1 ? 0 : cell]!;
export const roundDone = (r: RoundPlay): boolean => !!(r.found || r.timedOut);
export const mistakesMade = (s: OddState): number => s.rounds.reduce((n, r) => n + r.wrong.length + (r.timedOut ? 1 : 0), 0);
export const foundCount = (s: OddState): number => s.rounds.filter((r) => r.found).length;
export const outOfMistakes = (p: OddPuzzle, s: OddState): boolean => mistakesMade(s) > p.mistakes;
export const isSolved = (p: OddPuzzle, s: OddState): boolean => s.rounds.length === p.rounds.length && roundDone(s.rounds[s.rounds.length - 1]!) && !outOfMistakes(p, s);
export const isOver = (p: OddPuzzle, s: OddState): boolean => isSolved(p, s) || outOfMistakes(p, s);

export function reduce(p: OddPuzzle, s: OddState, a: OddAction): OddState {
  if (isOver(p, s)) return s;
  const i = s.rounds.length - 1;
  const play = s.rounds[i]!;
  const round = p.rounds[i]!;
  let next: RoundPlay;
  if (a.type === "pick") {
    if (!Number.isInteger(a.cell) || a.cell < 0 || a.cell >= cellCount(round) || play.wrong.includes(a.cell)) return s;
    next = a.cell === round.odd ? { ...play, found: true } : { ...play, wrong: [...play.wrong, a.cell] };
  } else if (a.type === "timeout") {
    if (!p.time) return s;
    next = { ...play, timedOut: true };
  } else return s;
  const rounds = [...s.rounds.slice(0, i), next];
  const out = { rounds };
  if (roundDone(next) && i < p.rounds.length - 1 && !outOfMistakes(p, out)) rounds.push({ wrong: [] });
  return out;
}

// --- generation ---

/** Items that can be an odd one: both pictures, a measured difference people can see, in the pool. */
export function candidates(pool: readonly DataItem[], variant: Media, plain: Media): DataItem[] {
  return pool.filter((it) => !!plain.url(it) && !!variant.url(it) && (variant.difference?.(it) ?? 0) >= FINDABLE);
}

/** Where in the order from most to least different round `k` of `n` aims (0: most different). */
export function target(difficulty: string, k: number, n: number): number {
  if (difficulty in DIFFICULTY) return DIFFICULTY[difficulty as keyof typeof DIFFICULTY];
  return n === 1 ? 0.5 : 0.04 + (0.92 * k) / (n - 1);
}

function generate(d: Dataset, v: Values<OddParams>, rng: Rng): OddPuzzle {
  const variant = d.media?.[v.variant];
  const plain = variant?.variantOf ? d.media?.[variant.variantOf] : undefined;
  if (!variant || !plain) throw new Error(`the ${d.name} data has no such variant picture`);
  const r = filter(d.items(), v.pool, d.attributes);
  if ("error" in r) throw new Error(`the filter: ${r.error}`);
  const pool = r.items;
  const noun = d.noun?.many ?? "items";
  const diff = (it: DataItem) => variant.difference?.(it) ?? 0;
  const ranked = candidates(pool, variant, plain).sort((a, b) => diff(b) - diff(a) || (a.id < b.id ? -1 : 1));
  if (!ranked.length) throw new Error(`the filter leaves no ${noun} whose ${variant.label} looks different`);
  const fillers = pool.filter((it) => !!plain.url(it));
  const mixed = v.grid === "mixed";
  if (mixed && fillers.length < 4) throw new Error(`different ${noun} needs at least 4 in the filter`);
  const used = new Set<string>();
  const rounds: OddRound[] = [];
  for (let k = 0; k < v.rounds; k++) {
    const t = target(v.difficulty, k, v.rounds);
    const at = Math.round(t * (ranked.length - 1));
    // the nearest few unused, widening until there are some to choose from
    let w = Math.max(2, Math.round(ranked.length * 0.04));
    let near: DataItem[] = [];
    for (; near.length < 3 && w < ranked.length * 2; w *= 2) near = ranked.slice(Math.max(0, at - w), at + w + 1).filter((it) => !used.has(it.id));
    if (!near.length) near = ranked.slice(Math.max(0, at - w), at + w + 1);
    const pick = rng.pick(near);
    used.add(pick.id);
    const size = Math.round(v.start + ((v.end - v.start) * k) / Math.max(1, v.rounds - 1));
    const cells = size * size;
    const odd = rng.int(cells);
    let ids = [pick.id];
    if (mixed) {
      const others = rng.shuffle(fillers.filter((it) => it.id !== pick.id).map((it) => it.id));
      ids = Array.from({ length: cells }, (_, c) => (c === odd ? pick.id : others[c % others.length]!));
    }
    const flips = v.mirror ? Array.from({ length: cells }, (_, c) => c).filter(() => rng.bool()) : [];
    rounds.push({ ids, size, odd, flips });
  }
  return { dataset: d.id, variant: v.variant, plain: variant.variantOf!, rounds, mistakes: v.mistakes, time: v.time, grid: mixed ? "mixed" : "same" };
}

const SQUARE = { clean: "🟩", slips: "🟨", missed: "🟥", unplayed: "⬛" } as const;

export function makeOddOneOut(data: DataSource): PuzzleDef<OddPuzzle, OddState, OddAction, OddInteraction, OddParams> {
  const params = makeParams(data);
  const words = (p: OddPuzzle) => {
    const d = data.get(p.dataset);
    return { noun: d?.noun?.many ?? "items", one: d?.noun?.one ?? "item", variant: d?.media?.[p.variant]?.label ?? "variant" };
  };
  return {
    id: "odd-one-out",
    name: "odd one out",
    aliases: ["find the shiny", "shiny hunt", "spot the shiny", "spot the odd one"],
    tags: ["observation"],
    description: "one picture in the grid is the odd one (a shiny among plain pokémon): find it. it gets subtler as you go.",
    datasetsOf: (p) => [p.dataset],
    generatorVersion: 1,
    params,
    get presets() {
      const on = (id: string, list: { label: string; params: Record<string, unknown> }[]) => (data.get(id) ? list.map((x) => ({ label: x.label, params: { dataset: id, ...x.params } })) : []);
      return [
        ...on("pokemon", [
          { label: "find the shiny (10 rounds, 3 × 3 to 5 × 5)", params: {} },
          { label: "find the shiny, timed (8 s a round)", params: { time: 8 } },
          { label: "subtle shinies only", params: { difficulty: "hard", start: 3, end: 3, rounds: 8 } },
          { label: "find the shiny among different pokémon", params: { grid: "mixed", start: 3, end: 4 } },
          { label: "big grids, mirrored", params: { start: 5, end: 7, mirror: true } },
          { label: "no mistakes", params: { mistakes: 0 } },
          { label: "gen 1 only", params: { pool: "form:default gen:1" } },
        ]),
        ...data.list().filter((d) => d.id !== "pokemon" && variantsOf(d).length).map((d) => ({ label: d.name, params: { dataset: d.id } })),
      ];
    },
    daily: { params: {} },
    irreversible: true,
    generate: (v, rng) => {
      const d = data.get(String(v.dataset));
      if (!d) throw new Error(`the ${v.dataset} dataset's pack isn't loaded`);
      return generate(d, effective(params, v), rng);
    },
    formats: [],
    init: () => ({ rounds: [{ wrong: [] }] }),
    initInteraction: () => ({ cursor: 0 }),
    reduce,
    isSolved,
    isLost: (p, s) => (outOfMistakes(p, s) ? { focus: { cells: [p.rounds[s.rounds.length - 1]!.odd] } satisfies OddFocus } : false),
    solve: (p, s) => (isOver(p, s) ? null : { moves: p.rounds.slice(s.rounds.length - 1).map((r): OddAction => ({ type: "pick", cell: r.odd })) }),
    hint(p, s): Hint<OddAction> | null {
      if (isOver(p, s)) return null;
      const r = p.rounds[s.rounds.length - 1]!;
      const row = Math.floor(r.odd / r.size), col = r.odd % r.size, half = Math.ceil(r.size / 2);
      const top = row < half, left = col < half;
      const cells: number[] = [];
      for (let c = 0; c < cellCount(r); c++) {
        const cr = Math.floor(c / r.size), cc = c % r.size;
        if ((cr < half) === top && (cc < half) === left) cells.push(c);
      }
      const where = `${top ? "top" : "bottom"} ${left ? "left" : "right"}`;
      return { message: `it's in the ${where}`, focus: { cells } satisfies OddFocus, level: 1, more: { message: `it's in the ${where}`, focus: { cells: [r.odd] } satisfies OddFocus, level: 2 } };
    },
    // rounds found first, then fewer mistakes: one scale for games that end early and games played out
    score(p, s) {
      const n = mistakesMade(s), f = foundCount(s);
      return { value: f * 100 - n, label: `${f}/${p.rounds.length} found, ${n === 1 ? "1 mistake" : `${n} mistakes`}`, better: "higher" };
    },
    shareText(p, s) {
      const marks = p.rounds.map((_, i) => {
        const r = s.rounds[i];
        if (!r || !roundDone(r)) return r && (r.wrong.length || outOfMistakes(p, s)) ? SQUARE.missed : SQUARE.unplayed;
        return r.timedOut ? SQUARE.missed : r.wrong.length ? SQUARE.slips : SQUARE.clean;
      });
      const lines: string[] = [];
      for (let k = 0; k < marks.length; k += 10) lines.push(marks.slice(k, k + 10).join(""));
      const n = mistakesMade(s);
      const tail = isSolved(p, s) ? (n === 0 ? "no mistakes" : n === 1 ? "1 mistake" : `${n} mistakes`) : `out at round ${s.rounds.length}`;
      return `odd one out (${words(p).variant}) ${foundCount(s)}/${p.rounds.length} · ${tail}\n${lines.join("\n")}`;
    },
    rules: (p) => [
      p.grid === "same" ? `every cell shows the same ${words(p).one}, but one of them is its ${words(p).variant}: it looks off. pick it.` : `every cell shows a different ${words(p).one}, and one of them is its ${words(p).variant}, not how it normally looks. pick it.`,
      `there are ${p.rounds.length} rounds; the odd ones get ${p.rounds.length > 1 ? "subtler and the grid bigger as you go" : "no easier"}.`,
      `${p.mistakes === 0 ? "one wrong pick ends the game" : `you can make ${p.mistakes} ${p.mistakes === 1 ? "mistake" : "mistakes"} in the whole game; one more ends it`}.${p.time ? ` each round has ${p.time} seconds; running out counts as a mistake.` : ""}`,
    ],
    describe: (p) => `${words(p).variant}, ${p.rounds.length} rounds${p.grid === "mixed" ? `, different ${words(p).noun}` : ""}${p.time ? `, ${p.time} s each` : ""}`,
    describeAction: (p, a, before, after) => {
      const i = before.rounds.length - 1;
      if (a.type === "timeout") return `round ${i + 1}: out of time`;
      const r = p.rounds[i]!;
      const cell = `row ${Math.floor(a.cell / r.size) + 1}, column ${(a.cell % r.size) + 1}`;
      return `round ${i + 1}: ${cell}${after.rounds[i]?.found ? " — the odd one" : ""}`;
    },
  };
}
