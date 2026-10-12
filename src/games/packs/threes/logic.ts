import type { Rng } from "../../core/rng";
import { defineSchema, type Values } from "../../core/schema";
import type { Format, PuzzleDef } from "../../core/types";
import { sha1 } from "../../lib/sha1";

/** Directions: 0 up, 1 right, 2 down, 3 left. */
export const DIR_NAMES = ["up", "right", "down", "left"] as const;

export const N = 4;
/** Tiles on the board when a game starts. */
const START_TILES = 9;
/** Every stack holds four of each of these; a new stack is made when one runs out. */
const STACK = [1, 1, 1, 1, 2, 2, 2, 2, 3, 3, 3, 3];
/** Bonus tiles can come once the biggest tile is this big. */
const BONUS_FROM = 48;
const BONUS_ODDS = 21;

export const params = defineSchema({
  goal: {
    type: "enum", label: "goal tile", default: "0",
    options: [{ value: "0", label: "none: play until stuck" }, ...["192", "384", "768", "1536"].map((v) => ({ value: v, label: v }))],
  },
});

export interface PuzzleThrees {
  /** Tiles by cell, row by row; 0 is empty. */
  start: number[];
  /** What is left of the current stack of 1s, 2s and 3s. */
  deck: number[];
  /** The first tile to come. */
  next: number;
  /** The first tile to come is a bonus tile, which the board shows only as "+". */
  bonus: boolean;
  seed: number;
  /** 0: no goal tile. */
  goal: number;
}

export interface StateThrees {
  grid: number[];
  deck: number[];
  /** The tile that comes in after the next slide. */
  next: number;
  /** `next` is a bonus tile: the board shows only "+" for it. */
  bonus: boolean;
  seed: number;
  moves: number;
}

export type ActionThrees = { type: "slide"; dir: number };

export interface FocusThrees {
  dir?: number;
  cells?: number[];
  /** Cells the next tile could come in on. */
  entries?: number[];
}

/** One mulberry32 step: the next state and a uniform number in [0, 1). */
export function draw(seed: number): [number, number] {
  const next = (seed + 0x6d2b79f5) >>> 0;
  let t = next;
  t = Math.imul(t ^ (t >>> 15), t | 1);
  t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
  return [next, ((t ^ (t >>> 14)) >>> 0) / 4294967296];
}

export const isTile = (v: number): boolean => v === 1 || v === 2 || (v >= 3 && Number.isInteger(Math.log2(v / 3)));

/** 1 and 2 merge into a 3; from 3 up, two equal tiles merge into their double. */
export const mergeable = (a: number, b: number): boolean => !!a && !!b && (a + b === 3 || (a >= 3 && a === b));

/** What a tile is worth in the score: nothing for 1 and 2, then 3, 9, 27, …, tripling at every doubling. */
export const tileScore = (v: number): number => (v < 3 ? 0 : 3 ** (Math.log2(v / 3) + 1));
export const scoreOf = (grid: readonly number[]): number => grid.reduce((sum, v) => sum + tileScore(v), 0);
export const best = (grid: readonly number[]): number => Math.max(0, ...grid);

/** The bonus tiles that can come while the biggest tile is `high`: 6 up to an eighth of it. */
export function bonusPool(high: number): number[] {
  const out: number[] = [];
  if (high < BONUS_FROM) return out;
  for (let v = 6; v <= high / 8; v *= 2) out.push(v);
  return out;
}

export interface Dealt {
  card: number;
  bonus: boolean;
  deck: number[];
  seed: number;
}

/** The next tile: one time in 21 a bonus tile once the biggest tile allows, else from the stack. */
export function deal(deck: readonly number[], seed: number, high: number): Dealt {
  let s = seed;
  const pool = bonusPool(high);
  if (pool.length) {
    const [s1, u] = draw(s);
    s = s1;
    if (u < 1 / BONUS_ODDS) {
      const [s2, v] = draw(s);
      return { card: pool[Math.floor(v * pool.length)]!, bonus: true, deck: deck.slice(), seed: s2 };
    }
  }
  const stack = deck.length ? deck.slice() : STACK.slice();
  const [s3, a] = draw(s);
  const [card] = stack.splice(Math.floor(a * stack.length), 1);
  return { card: card!, bonus: false, deck: stack, seed: s3 };
}

/** Cells of each line in the direction of travel, the front cell first. */
export function lines(n: number, dir: number): number[][] {
  const out: number[][] = [];
  for (let i = 0; i < n; i++) {
    const line: number[] = [];
    for (let k = 0; k < n; k++) {
      if (dir === 0) line.push(k * n + i);
      else if (dir === 2) line.push((n - 1 - k) * n + i);
      else if (dir === 3) line.push(i * n + k);
      else line.push(i * n + (n - 1 - k));
    }
    out.push(line);
  }
  return out;
}

export interface Shifted {
  /** The board after every tile that can has moved one cell, before the new tile. */
  grid: number[];
  /** Every moving tile: from, to, and whether it merged into the tile standing there. */
  moves: { from: number; to: number; merged: boolean }[];
  /** Indexes (into `lines`) of the lines where something moved. */
  moved: number[];
  /** Where the new tile can come in: the back cell of each moved line. */
  entries: number[];
  changed: boolean;
}

/**
 * Every tile moves one cell toward the front if the cell is empty, is being emptied by the tile
 * in it moving, or holds a tile it merges with. Nothing merges twice, and tiles behind a moving
 * tile always move too, so the back cell of a line where something moved is always empty.
 */
export function shift(n: number, grid: readonly number[], dir: number): Shifted {
  const out = grid.slice();
  const moves: Shifted["moves"] = [];
  const moved: number[] = [];
  const entries: number[] = [];
  lines(n, dir).forEach((line, i) => {
    const moving: boolean[] = [];
    for (let k = 1; k < n; k++) {
      const v = grid[line[k]!]!;
      const front = grid[line[k - 1]!]!;
      moving[k] = !!v && (!front || !!moving[k - 1] || mergeable(front, v));
    }
    const next = Array.from({ length: n }, (_, k) => (moving[k] ? 0 : grid[line[k]!]!));
    for (let k = 1; k < n; k++) {
      if (!moving[k]) continue;
      const v = grid[line[k]!]!;
      const hit = next[k - 1]!;
      next[k - 1] = hit ? hit + v : v;
      moves.push({ from: line[k]!, to: line[k - 1]!, merged: !!hit });
    }
    if (moving.some(Boolean)) {
      moved.push(i);
      entries.push(line[n - 1]!);
    }
    line.forEach((c, k) => { out[c] = next[k]!; });
  });
  return { grid: out, moves, moved, entries, changed: moved.length > 0 };
}

export const canSlide = (n: number, grid: readonly number[], dir: number): boolean => shift(n, grid, dir).changed;

export function reduce(p: PuzzleThrees, s: StateThrees, a: ActionThrees): StateThrees {
  if (a.type !== "slide" || a.dir < 0 || a.dir > 3) return s;
  const r = shift(N, s.grid, a.dir);
  if (!r.changed) return s;
  const [seed, u] = draw(s.seed);
  const grid = r.grid;
  grid[r.entries[Math.floor(u * r.entries.length)]!] = s.next;
  const d = deal(s.deck, seed, best(grid));
  return { grid, deck: d.deck, next: d.card, bonus: d.bonus, seed: d.seed, moves: s.moves + 1 };
}

// --- formats ---

const seedOf = (text: string): number => {
  const h = sha1(new TextEncoder().encode(text));
  return ((h[0]! << 24) | (h[1]! << 16) | (h[2]! << 8) | h[3]!) >>> 0;
};

/**
 * Four rows of tiles (1, 2, 3, 6, 12, … or . for empty), then optionally `next 2` (`next +12` for
 * a bonus tile), `deck 1 1 2 3`, `goal 384` and `seed 12345` lines. Without a seed, one is made
 * from the text, so the same text always plays the same.
 */
export const gridFormat: Format<PuzzleThrees> = {
  id: "grid",
  label: "grid (4 rows of tiles, . for empty)",
  detect: (t) => /^[\d.\s]+((goal|seed|next|deck)\s+[+\d\s]+)*$/i.test(t.trim()) && t.trim().includes("\n"),
  parse(text) {
    let seed: number | null = null, goal = 0, next: { v: number; bonus: boolean } | null = null, deck: number[] | null = null;
    const rows: string[][] = [];
    for (const l of text.trim().split(/\r?\n/).map((x) => x.trim()).filter(Boolean)) {
      const m = /^(goal|seed|next|deck)\s+(.+)$/i.exec(l);
      if (!m) { rows.push(l.split(/\s+/)); continue; }
      const key = m[1]!.toLowerCase(), val = m[2]!.trim();
      if (key === "seed") seed = Number(val) >>> 0;
      else if (key === "goal") {
        goal = Number(val);
        if (!isTile(goal) || goal < 6) throw new Error("the goal tile must be a tile such as 192 or 384");
      } else if (key === "next") {
        const v = Number(val.replace("+", ""));
        if (!isTile(v)) throw new Error(`"${val}" isn't a tile (1, 2, 3, 6, 12, …)`);
        next = { v, bonus: val.startsWith("+") };
      } else {
        deck = val.split(/\s+/).map(Number);
        if (deck.some((v) => v < 1 || v > 3 || !Number.isInteger(v))) throw new Error("the deck holds only 1s, 2s and 3s");
      }
    }
    if (rows.length !== N || rows.some((r) => r.length !== N)) throw new Error(`the board must be ${N} rows of ${N} tiles`);
    const start = rows.flat().map((t) => {
      if (t === "." || t === "0") return 0;
      const v = Number(t);
      if (!isTile(v)) throw new Error(`"${t}" isn't a tile (1, 2, 3, 6, 12, …)`);
      return v;
    });
    const sd = seed ?? seedOf(text);
    if (next) return { start, deck: deck ?? [], next: next.v, bonus: next.bonus, seed: sd, goal };
    const d = deal(deck ?? [], sd, best(start));
    return { start, deck: d.deck, next: d.card, bonus: d.bonus, seed: d.seed, goal };
  },
  serialize(p) {
    const width = String(best(p.start) || 1).length;
    const rows: string[] = [];
    for (let y = 0; y < N; y++) rows.push(p.start.slice(y * N, y * N + N).map((v) => (v ? String(v) : ".").padStart(width)).join(" "));
    return `${rows.join("\n")}\nnext ${p.bonus ? "+" : ""}${p.next}\n${p.deck.length ? `deck ${p.deck.join(" ")}\n` : ""}${p.goal ? `goal ${p.goal}\n` : ""}seed ${p.seed}`;
  },
};

function generate(v: Values<typeof params>, rng: Rng): PuzzleThrees {
  let seed = rng.int(2 ** 32) >>> 0;
  let deck: number[] = [];
  const cells = rng.shuffle(Array.from({ length: N * N }, (_, i) => i)).slice(0, START_TILES);
  const start = Array.from({ length: N * N }, () => 0);
  for (const c of cells) {
    const d = deal(deck, seed, 0);
    start[c] = d.card;
    deck = d.deck;
    seed = d.seed;
  }
  const d = deal(deck, seed, 0);
  return { start, deck: d.deck, next: d.card, bonus: d.bonus, seed: d.seed, goal: Number(v.goal) };
}

export const gameThrees: PuzzleDef<PuzzleThrees, StateThrees, ActionThrees, null, typeof params> = {
  id: "threes",
  name: "threes",
  aliases: ["threes!", "sliding tiles game", "merge numbers"],
  tags: ["moves", "numbers", "endless"],
  description: "every slide moves each tile one step. a 1 and a 2 make a 3; after that two equal tiles merge into their double. you see what comes in next. play until you're stuck; the score is the sum of what the tiles are worth.",
  generatorVersion: 1,
  params,
  presets: [
    { label: "play until stuck", params: { goal: "0" } },
    { label: "make a 192", params: { goal: "192" } },
    { label: "make a 768", params: { goal: "768" } },
  ],
  generate,
  formats: [gridFormat],
  init: (p) => ({ grid: p.start.slice(), deck: p.deck.slice(), next: p.next, bonus: p.bonus, seed: p.seed, moves: 0 }),
  reduce,
  isSolved: (p, s) => p.goal > 0 && best(s.grid) >= p.goal,
  isLost: (p, s) => [0, 1, 2, 3].every((d) => !canSlide(N, s.grid, d)),
  describeAction(p, a, before, after) {
    if (a.type !== "slide") return "";
    const gained = scoreOf(after.grid) - scoreOf(before.grid);
    return `${DIR_NAMES[a.dir]}${gained > 0 ? ` +${gained}` : ""}`;
  },
  rules: (p) => [
    "every slide moves each tile one step, not all the way. a tile that is blocked stays put.",
    "a 1 and a 2 that meet merge into a 3. from 3 up, two equal tiles that meet merge into their double (3 and 3 make 6, 6 and 6 make 12).",
    "after every slide that moves something, the tile shown above the board slides in at the edge you slid away from, on one of the lines that moved. a bonus tile shows only as +.",
    "a tile is worth points by how many times it has doubled from 3: 3 is worth 3, 6 is worth 9, 12 is worth 27, and so on. 1 and 2 are worth nothing. the score is what all the tiles on the board are worth.",
    p.goal ? `make a ${p.goal} tile. the game is over when no slide moves anything; once you've won you can unlock the board and keep going.` : "there's no goal: play until no slide moves anything.",
  ],
  describe: (p) => (p.goal ? `goal ${p.goal}` : "until stuck"),
};
