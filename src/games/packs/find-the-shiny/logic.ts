import type { Rng } from "../../core/rng";
import { defineSchema, type Values } from "../../core/schema";
import type { Hint, PuzzleDef } from "../../core/types";
import { poolField, poolOf } from "../../lib/pokemon/pool";
import type { PokemonDataset, PokemonItem } from "../../lib/pokemon/types";

/**
 * How different each item's shiny sprite looks from its normal one: mean colour difference (ΔE)
 * over the pixels either draws, measured by measure.ts. Items missing here have no measurement
 * (or no shiny) and are never used.
 */
export type ShinyDiff = Readonly<Record<string, number>>;

/** Below this the two sprites look the same at any size people play at (checked by eye on a sheet of the lowest). */
export const FINDABLE = 2;

export const DIFFICULTY = { easy: 0.12, medium: 0.45, hard: 0.75, subtle: 0.95 } as const;

export const makeParams = (dataset: () => PokemonDataset | undefined) => defineSchema({
  grid: {
    type: "enum", label: "grid", default: "same",
    options: [
      { value: "same", label: "all the same pokémon", description: "spot the one whose colors are off" },
      { value: "mixed", label: "different pokémon", description: "you need to know how each one normally looks" },
    ],
  },
  rounds: { type: "int", label: "rounds", default: 10, min: 1, max: 30 },
  difficulty: {
    type: "enum", label: "how different the shiny looks", default: "ramp",
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
  mirror: { type: "bool", label: "some face the other way", default: false, description: "so the shiny can't be spotted by lining cells up" },
  pool: poolField(dataset),
});

export type ShinyParams = ReturnType<typeof makeParams>;

export interface ShinyRound {
  /** Pokémon per cell, row-major; a same-species round lists its one pokémon once. */
  ids: string[];
  /** Cells per side. */
  size: number;
  /** The shiny cell. */
  shiny: number;
  /** Cells drawn mirrored. */
  flips: number[];
}

export interface ShinyPuzzle {
  rounds: ShinyRound[];
  mistakes: number;
  /** Seconds per round, 0 for no limit. */
  time: number;
  grid: "same" | "mixed";
}

export interface RoundPlay {
  /** Cells picked that weren't the shiny, in order. */
  wrong: number[];
  found?: true;
  timedOut?: true;
}

export interface ShinyState {
  /** Rounds reached; the last is the one being played unless the game is over. */
  rounds: RoundPlay[];
}

export type ShinyAction = { type: "pick"; cell: number } | { type: "timeout" };

export interface ShinyInteraction {
  cursor: number;
}

export interface ShinyFocus {
  cells: number[];
}

export const cellCount = (r: ShinyRound): number => r.size * r.size;
export const idAt = (r: ShinyRound, cell: number): string => r.ids[r.ids.length === 1 ? 0 : cell]!;
export const roundDone = (r: RoundPlay): boolean => !!(r.found || r.timedOut);
export const mistakesMade = (s: ShinyState): number => s.rounds.reduce((n, r) => n + r.wrong.length + (r.timedOut ? 1 : 0), 0);
export const foundCount = (s: ShinyState): number => s.rounds.filter((r) => r.found).length;
export const outOfMistakes = (p: ShinyPuzzle, s: ShinyState): boolean => mistakesMade(s) > p.mistakes;
export const isSolved = (p: ShinyPuzzle, s: ShinyState): boolean => s.rounds.length === p.rounds.length && roundDone(s.rounds[s.rounds.length - 1]!) && !outOfMistakes(p, s);
export const isOver = (p: ShinyPuzzle, s: ShinyState): boolean => isSolved(p, s) || outOfMistakes(p, s);

export function reduce(p: ShinyPuzzle, s: ShinyState, a: ShinyAction): ShinyState {
  if (isOver(p, s)) return s;
  const i = s.rounds.length - 1;
  const play = s.rounds[i]!;
  const round = p.rounds[i]!;
  let next: RoundPlay;
  if (a.type === "pick") {
    if (!Number.isInteger(a.cell) || a.cell < 0 || a.cell >= cellCount(round) || play.wrong.includes(a.cell)) return s;
    next = a.cell === round.shiny ? { ...play, found: true } : { ...play, wrong: [...play.wrong, a.cell] };
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

/** Items that can be a shiny round: both sprites, a measured difference people can see, in the pool. */
export function candidates(pool: readonly PokemonItem[], diff: ShinyDiff): PokemonItem[] {
  return pool.filter((it) => it.media.includes("sprite") && it.media.includes("shiny") && (diff[it.id] ?? 0) >= FINDABLE);
}

/** Where in the order from most to least different round `k` of `n` aims (0: most different). */
export function target(difficulty: string, k: number, n: number): number {
  if (difficulty in DIFFICULTY) return DIFFICULTY[difficulty as keyof typeof DIFFICULTY];
  return n === 1 ? 0.5 : 0.04 + (0.92 * k) / (n - 1);
}

function generate(d: PokemonDataset, diff: ShinyDiff, v: Values<ShinyParams>, rng: Rng): ShinyPuzzle {
  const pool = poolOf(d, v.pool);
  const ranked = candidates(pool, diff).sort((a, b) => diff[b.id]! - diff[a.id]! || (a.id < b.id ? -1 : 1));
  if (!ranked.length) throw new Error("the pokémon filter leaves no pokémon with a shiny that looks different");
  const fillers = pool.filter((it) => it.media.includes("sprite"));
  const mixed = v.grid === "mixed";
  if (mixed && fillers.length < 4) throw new Error("different pokémon needs at least 4 in the filter");
  const used = new Set<string>();
  const rounds: ShinyRound[] = [];
  for (let k = 0; k < v.rounds; k++) {
    const t = target(v.difficulty, k, v.rounds);
    const at = Math.round(t * (ranked.length - 1));
    // the nearest few unused, widening until there are some to choose from
    let w = Math.max(2, Math.round(ranked.length * 0.04));
    let near: PokemonItem[] = [];
    for (; near.length < 3 && w < ranked.length * 2; w *= 2) near = ranked.slice(Math.max(0, at - w), at + w + 1).filter((it) => !used.has(it.id));
    if (!near.length) near = ranked.slice(Math.max(0, at - w), at + w + 1);
    const pick = rng.pick(near);
    used.add(pick.id);
    const size = Math.round(v.start + ((v.end - v.start) * k) / Math.max(1, v.rounds - 1));
    const cells = size * size;
    const shiny = rng.int(cells);
    let ids = [pick.id];
    if (mixed) {
      const others = rng.shuffle(fillers.filter((it) => it.base !== pick.base).map((it) => it.id));
      ids = Array.from({ length: cells }, (_, c) => (c === shiny ? pick.id : others[c % others.length]!));
    }
    const flips = v.mirror ? Array.from({ length: cells }, (_, c) => c).filter(() => rng.bool()) : [];
    rounds.push({ ids, size, shiny, flips });
  }
  return { rounds, mistakes: v.mistakes, time: v.time, grid: mixed ? "mixed" : "same" };
}

const SQUARE = { clean: "🟩", slips: "🟨", missed: "🟥", unplayed: "⬛" } as const;

export function makeFindTheShiny(dataset: () => PokemonDataset | undefined, diff: ShinyDiff): PuzzleDef<ShinyPuzzle, ShinyState, ShinyAction, ShinyInteraction, ShinyParams> {
  const data = (): PokemonDataset => {
    const d = dataset();
    if (!d) throw new Error("the pokémon data pack isn't loaded");
    return d;
  };
  const params = makeParams(dataset);
  return {
    id: "find-the-shiny",
    name: "Find the shiny",
    aliases: ["shiny hunt", "spot the shiny", "odd one out", "spot the difference"],
    tags: ["observation", "pokémon"],
    description: "one pokémon in the grid is shiny: find it. the shinies get subtler as you go.",
    datasets: ["pokemon"],
    generatorVersion: 1,
    params,
    presets: [
      { label: "classic (10 rounds, 3 × 3 to 5 × 5)", params: {} },
      { label: "timed (8 s a round)", params: { time: 8 } },
      { label: "subtle shinies only", params: { difficulty: "hard", start: 3, end: 3, rounds: 8 } },
      { label: "different pokémon", params: { grid: "mixed", start: 3, end: 4 } },
      { label: "big grids, mirrored", params: { start: 5, end: 7, mirror: true } },
      { label: "no mistakes", params: { mistakes: 0 } },
      { label: "gen 1 only", params: { pool: "form:default gen:1" } },
    ],
    daily: { params: {} },
    irreversible: true,
    generate: (v, rng) => generate(data(), diff, v, rng),
    formats: [],
    init: () => ({ rounds: [{ wrong: [] }] }),
    initInteraction: () => ({ cursor: 0 }),
    reduce,
    isSolved,
    isLost: (p, s) => (outOfMistakes(p, s) ? { focus: { cells: [p.rounds[s.rounds.length - 1]!.shiny] } satisfies ShinyFocus } : false),
    solve: (p, s) => (isOver(p, s) ? null : { moves: p.rounds.slice(s.rounds.length - 1).map((r): ShinyAction => ({ type: "pick", cell: r.shiny })) }),
    hint(p, s): Hint<ShinyAction> | null {
      if (isOver(p, s)) return null;
      const r = p.rounds[s.rounds.length - 1]!;
      const row = Math.floor(r.shiny / r.size), col = r.shiny % r.size, half = Math.ceil(r.size / 2);
      const top = row < half, left = col < half;
      const cells: number[] = [];
      for (let c = 0; c < cellCount(r); c++) {
        const cr = Math.floor(c / r.size), cc = c % r.size;
        if ((cr < half) === top && (cc < half) === left) cells.push(c);
      }
      const where = `${top ? "top" : "bottom"} ${left ? "left" : "right"}`;
      return { message: `it's in the ${where}`, focus: { cells } satisfies ShinyFocus, level: 1, more: { message: `it's in the ${where}`, focus: { cells: [r.shiny] } satisfies ShinyFocus, level: 2 } };
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
      return `Find the shiny ✨ ${foundCount(s)}/${p.rounds.length} · ${tail}\n${lines.join("\n")}`;
    },
    rules: (p) => [
      p.grid === "same" ? "every cell shows the same pokémon, but one of them is shiny: its colors are off. pick it." : "every cell shows a different pokémon, and one of them is shiny: in other colors than it normally has. pick it.",
      `there are ${p.rounds.length} rounds; the shinies get ${p.rounds.length > 1 ? "subtler and the grid bigger as you go" : "no easier"}.`,
      `${p.mistakes === 0 ? "one wrong pick ends the game" : `you can make ${p.mistakes} ${p.mistakes === 1 ? "mistake" : "mistakes"} in the whole game; one more ends it`}.${p.time ? ` each round has ${p.time} seconds; running out counts as a mistake.` : ""}`,
    ],
    describe: (p) => `${p.rounds.length} rounds${p.grid === "mixed" ? ", different pokémon" : ""}${p.time ? `, ${p.time} s each` : ""}`,
    describeAction: (p, a, before, after) => {
      const i = before.rounds.length - 1;
      if (a.type === "timeout") return `round ${i + 1}: out of time`;
      const r = p.rounds[i]!;
      const cell = `row ${Math.floor(a.cell / r.size) + 1}, column ${(a.cell % r.size) + 1}`;
      return `round ${i + 1}: ${cell}${after.rounds[i]?.found ? " — the shiny" : ""}`;
    },
  };
}
