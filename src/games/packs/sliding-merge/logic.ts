import type { Ids } from "../../core/commands";
import { featureTests } from "../../core/define";
import type { Rng } from "../../core/rng";
import { defineSchema, resolve, type Values } from "../../core/schema";
import type { Format, PuzzleDef } from "../../core/types";
import { sha1 } from "../../lib/sha1";

/** Directions: 0 up, 1 right, 2 down, 3 left. */
export const DIR_NAMES = ["up", "right", "down", "left"] as const;

/** A cell holding a fixed block: it never moves, nothing merges with it and nothing lands on it. */
export const BLOCK = -1;

export type MergeId = "doubles" | "threes" | "fives" | "fibonacci";

export interface MergeRule {
  /** The tiles new tiles are drawn from, smallest first. */
  bases: readonly number[];
  /** What `a` and `b` merge into when they meet, or 0 if they don't merge. */
  merge(a: number, b: number): number;
  /**
   * Place on the ladder of merged tiles, from 1 for its first rung (2 in 2048, 3 in threes, 1 in
   * 2584); 0 for starting tiles below the ladder (1 and 2 in threes). Bigger tiles rank higher.
   */
  rank(v: number): number;
  /** The tile at a rank (inverse of `rank` from 1 up). */
  value(rank: number): number;
}

const log2 = Math.log2;
const isPow2 = (v: number) => v > 0 && Number.isInteger(log2(v));

/** Fibonacci numbers by rank: 1, 2, 3, 5, 8, … (rank 1 is 1). */
const fib = (rank: number): number => {
  let a = 1, b = 2;
  for (let i = 1; i < rank; i++) [a, b] = [b, a + b];
  return a;
};
const fibRank = (v: number): number => {
  let a = 1, b = 2, r = 1;
  while (a < v) { [a, b] = [b, a + b]; r++; }
  return a === v ? r : -1;
};

/** Threes and fives: two starting tiles that add up to the first rung, then doubling from it. */
const pairThenDouble = (lo: number, hi: number): MergeRule => {
  const first = lo + hi;
  return {
    bases: [lo, hi, first],
    merge: (a, b) => (a > 0 && b > 0 && a !== b && a + b === first ? first : a >= first && a === b ? 2 * a : 0),
    rank: (v) => (v === lo || v === hi ? 0 : v >= first && isPow2(v / first) ? log2(v / first) + 1 : -1),
    value: (r) => first * 2 ** (r - 1),
  };
};

export const MERGES: Record<MergeId, MergeRule> = {
  doubles: {
    bases: [2, 4],
    merge: (a, b) => (a > 0 && a === b ? 2 * a : 0),
    rank: (v) => (v >= 2 && isPow2(v) ? log2(v) : -1),
    value: (r) => 2 ** r,
  },
  threes: pairThenDouble(1, 2),
  fives: pairThenDouble(2, 3),
  fibonacci: {
    bases: [1, 2],
    merge: (a, b) => {
      if (a <= 0 || b <= 0) return 0;
      const ra = fibRank(a), rb = fibRank(b);
      return ra > 0 && rb > 0 && (Math.abs(ra - rb) === 1 || (a === 1 && b === 1)) ? a + b : 0;
    },
    rank: (v) => (v > 0 ? fibRank(v) : -1),
    value: fib,
  },
};

export const isTile = (m: MergeRule, v: number): boolean => m.rank(v) >= 0;

export interface Rules {
  merge: MergeId;
  /** far: every tile slides as far as it goes (2048); step: one cell at most (threes). */
  slide: "far" | "step";
  /** Where a new tile lands: any empty cell, or the back cell of a line that moved. */
  entry: "anywhere" | "edge";
  /** random: each new tile drawn on its own; stack: drawn from a stack holding four of each starting tile. */
  source: "random" | "stack";
  /** Percent chance (random source) that a new tile is the biggest starting tile (a 4 in 2048). */
  big: number;
  /** Bonus tiles come one time in 21 once the biggest tile is far enough up the ladder (threes). */
  bonus: boolean;
  /** The next tile is shown (a bonus tile only as +). */
  preview: boolean;
  /** merges: every merge scores the tile it makes (2048); worth: the board's tiles are worth 3 to their rank (threes). */
  score: "merges" | "worth";
  /** The goal tile, 0 for none. */
  goal: number;
}

export interface PuzzleMerge {
  size: number;
  rules: Rules;
  /** Tiles by cell, row by row; 0 empty, BLOCK a fixed block. */
  start: number[];
  /** What is left of the current stack (stack source). */
  deck: number[];
  /** The first tile to come. */
  next: number;
  /** The first tile to come is a bonus tile. */
  bonus: boolean;
  /** Random state new tiles are drawn from; the same seed always brings the same tiles. */
  seed: number;
}

export interface StateMerge {
  grid: number[];
  deck: number[];
  /** The tile that comes in after the next slide that moves something. */
  next: number;
  /** `next` is a bonus tile. */
  bonus: boolean;
  seed: number;
  moves: number;
  /** Points from merges so far: the value of every tile a merge made. */
  score: number;
}

export type ActionMerge = { type: "slide"; dir: number };

export interface FocusMerge {
  dir?: number;
  /** Cells to point at. */
  cells?: number[];
  /** Cells the next tile could land on. */
  entries?: number[];
}

export const mergeOf = (p: { rules: Rules }): MergeRule => MERGES[p.rules.merge];

/** One mulberry32 step: the next state and a uniform number in [0, 1). */
export function draw(seed: number): [number, number] {
  const next = (seed + 0x6d2b79f5) >>> 0;
  let t = next;
  t = Math.imul(t ^ (t >>> 15), t | 1);
  t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
  return [next, ((t ^ (t >>> 14)) >>> 0) / 4294967296];
}

export const best = (grid: readonly number[]): number => Math.max(0, ...grid);

/** What a tile is worth under `worth` scoring: 3 to the power of its rank (3 → 3, 6 → 9 in threes), nothing below the ladder. */
export const tileWorth = (m: MergeRule, v: number): number => (v > 0 && m.rank(v) > 0 ? 3 ** m.rank(v) : 0);

export const scoreOf = (p: { rules: Rules }, s: { grid: readonly number[]; score: number }): number =>
  p.rules.score === "merges" ? s.score : s.grid.reduce((sum, v) => sum + tileWorth(mergeOf(p), v), 0);

/** Bonus tiles start once the biggest tile reaches this rank (48 in threes). */
const BONUS_FROM = 5;
const BONUS_ODDS = 21;

/** The bonus tiles that can come while the biggest tile is `high`: from the second rung up to three rungs below it. */
export function bonusPool(m: MergeRule, high: number): number[] {
  const r = high > 0 ? m.rank(high) : 0;
  if (r < BONUS_FROM) return [];
  const out: number[] = [];
  for (let k = 2; k <= r - 3; k++) out.push(m.value(k));
  return out;
}

/** Four of each starting tile. */
export const fullStack = (m: MergeRule): number[] => m.bases.flatMap((v) => [v, v, v, v]);

export interface Dealt {
  card: number;
  bonus: boolean;
  deck: number[];
  seed: number;
}

/** The next tile, given the biggest tile on the board (for bonus tiles). */
export function deal(rules: Rules, deck: readonly number[], seed: number, high: number): Dealt {
  const m = MERGES[rules.merge];
  let s = seed;
  if (rules.bonus) {
    const pool = bonusPool(m, high);
    if (pool.length) {
      const [s1, u] = draw(s);
      s = s1;
      if (u < 1 / BONUS_ODDS) {
        const [s2, v] = draw(s);
        return { card: pool[Math.floor(v * pool.length)]!, bonus: true, deck: deck.slice(), seed: s2 };
      }
    }
  }
  if (rules.source === "stack") {
    const stack = deck.length ? deck.slice() : fullStack(m);
    const [s3, a] = draw(s);
    const [card] = stack.splice(Math.floor(a * stack.length), 1);
    return { card: card!, bonus: false, deck: stack, seed: s3 };
  }
  const [s3, a] = draw(s);
  const top = m.bases[m.bases.length - 1]!;
  if (a < rules.big / 100) return { card: top, bonus: false, deck: deck.slice(), seed: s3 };
  const rest = m.bases.slice(0, -1);
  const [s4, b] = draw(s3);
  return { card: rest[Math.floor(b * rest.length)]!, bonus: false, deck: deck.slice(), seed: s4 };
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

/** A line cut at its blocks: the runs of cells tiles can move along, front cell first. */
function segments(line: readonly number[], grid: readonly number[]): number[][] {
  const out: number[][] = [[]];
  for (const c of line) {
    if (grid[c] === BLOCK) out.push([]);
    else out[out.length - 1]!.push(c);
  }
  return out.filter((s) => s.length);
}

export interface Moved {
  /** The board after the slide, before the new tile. */
  grid: number[];
  /** Points from merges: the value of every tile a merge made. */
  gained: number;
  /** Every tile's journey: from, to, and whether it merged into another there. */
  moves: { from: number; to: number; merged: boolean }[];
  /** Where an edge-entering tile can land: the back cell of each run that moved (always empty). */
  entries: number[];
  changed: boolean;
}

/**
 * One slide. `far`: every tile slides as far as it goes and two tiles that meet merge, each tile
 * at most once, the front pair first. `step`: every tile moves one cell toward the front if the
 * cell is empty, is being emptied by the tile in it moving, or holds a tile it merges with.
 */
export function move(p: { size: number; rules: Rules }, grid: readonly number[], dir: number): Moved {
  const m = mergeOf(p);
  const out = grid.slice();
  const moves: Moved["moves"] = [];
  const entries: number[] = [];
  let gained = 0;
  for (const line of lines(p.size, dir)) {
    for (const seg of segments(line, grid)) {
      const len = seg.length;
      const next = Array.from({ length: len }, () => 0);
      let moved = false;
      if (p.rules.slide === "far") {
        let at = -1, open = false;
        for (let k = 0; k < len; k++) {
          const v = grid[seg[k]!]!;
          if (!v) continue;
          const made = open ? m.merge(next[at]!, v) : 0;
          if (made) {
            next[at] = made;
            gained += made;
            open = false;
            moves.push({ from: seg[k]!, to: seg[at]!, merged: true });
          } else {
            next[++at] = v;
            open = true;
            moves.push({ from: seg[k]!, to: seg[at]!, merged: false });
          }
          if (seg[at] !== seg[k]) moved = true;
        }
      } else {
        const going: boolean[] = [false];
        for (let k = 1; k < len; k++) {
          const v = grid[seg[k]!]!, front = grid[seg[k - 1]!]!;
          going[k] = !!v && (!front || going[k - 1]! || !!m.merge(front, v));
        }
        for (let k = 0; k < len; k++) next[k] = going[k] ? 0 : grid[seg[k]!]!;
        for (let k = 1; k < len; k++) {
          if (!going[k]) continue;
          const v = grid[seg[k]!]!, hit = next[k - 1]!;
          const made = hit ? m.merge(hit, v) : 0;
          next[k - 1] = made || v;
          gained += made;
          moves.push({ from: seg[k]!, to: seg[k - 1]!, merged: !!made });
          moved = true;
        }
      }
      if (moved) entries.push(seg[len - 1]!);
      seg.forEach((c, k) => { out[c] = next[k]!; });
    }
  }
  return { grid: out, gained, moves, entries, changed: entries.length > 0 };
}

export const canSlide = (p: { size: number; rules: Rules }, grid: readonly number[], dir: number): boolean => move(p, grid, dir).changed;

/** Cells a new tile can land on after the slide `r`. */
export const landing = (p: { rules: Rules }, r: Moved): number[] =>
  p.rules.entry === "edge" ? r.entries : r.grid.flatMap((v, c) => (v ? [] : [c]));

export function reduce(p: PuzzleMerge, s: StateMerge, a: ActionMerge): StateMerge {
  if (a.type !== "slide" || a.dir < 0 || a.dir > 3) return s;
  const r = move(p, s.grid, a.dir);
  if (!r.changed) return s;
  const spots = landing(p, r);
  const [seed, u] = draw(s.seed);
  const grid = r.grid;
  grid[spots[Math.floor(u * spots.length)]!] = s.next;
  const d = deal(p.rules, s.deck, seed, best(grid));
  return { grid, deck: d.deck, next: d.card, bonus: d.bonus, seed: d.seed, moves: s.moves + 1, score: s.score + r.gained };
}

// --- settings ---

const goalField = (rule: MergeId, def: string, values: number[]) => ({
  type: "enum", label: "goal tile", default: def,
  when: (v: Record<string, unknown>) => v.rule === rule,
  options: [{ value: "0", label: "none: play until stuck" }, ...values.map((v) => ({ value: String(v), label: String(v) }))],
} as const);

const ladder = (m: MergeRule, from: number, to: number) => Array.from({ length: to - from + 1 }, (_, i) => m.value(from + i));

export const params = defineSchema({
  rule: {
    type: "enum", label: "merge rule", default: "doubles",
    options: [
      { value: "doubles", label: "equal tiles", description: "2 and 2 make 4, 4 and 4 make 8 (2048)" },
      { value: "threes", label: "1 + 2, then equal tiles", description: "a 1 and a 2 make a 3; from 3 up two equal tiles make their double (threes)" },
      { value: "fives", label: "2 + 3, then equal tiles", description: "a 2 and a 3 make a 5; from 5 up two equal tiles make their double (fives)" },
      { value: "fibonacci", label: "neighbouring fibonacci numbers", description: "1 and 1 make 2, 1 and 2 make 3, 2 and 3 make 5 (2584)" },
    ],
  },
  slide: {
    type: "enum", label: "a slide moves tiles", default: "far",
    options: [{ value: "far", label: "as far as they go" }, { value: "step", label: "one step" }],
  },
  entry: {
    type: "enum", label: "new tiles land", default: "anywhere",
    options: [{ value: "anywhere", label: "on any empty cell" }, { value: "edge", label: "at the edge slid away from, on a line that moved" }],
  },
  source: {
    type: "enum", label: "new tiles come", default: "random",
    options: [{ value: "random", label: "at random" }, { value: "stack", label: "from a stack of four of each" }],
  },
  big: { type: "int", label: "chance of the bigger new tile (%)", default: 10, min: 0, max: 100, when: (v) => v.source === "random" },
  bonus: { type: "bool", label: "bonus tiles", default: false, description: "once the biggest tile is big enough, a bigger tile comes now and then" },
  preview: { type: "bool", label: "show the next tile", default: false },
  score: {
    type: "enum", label: "score", default: "merges",
    options: [{ value: "merges", label: "every merge scores its new tile" }, { value: "worth", label: "what the tiles on the board are worth" }],
  },
  size: { type: "int", label: "size", default: 4, min: 3, max: 8 },
  start: { type: "int", label: "tiles at the start", default: 2, min: 1, max: 20 },
  blocks: { type: "int", label: "fixed blocks", default: 0, min: 0, max: 4 },
  goal: goalField("doubles", "2048", ladder(MERGES.doubles, 5, 16)),
  goalThrees: goalField("threes", "0", ladder(MERGES.threes, 6, 12)),
  goalFives: goalField("fives", "0", ladder(MERGES.fives, 6, 12)),
  goalFib: goalField("fibonacci", "2584", ladder(MERGES.fibonacci, 10, 19)),
});

type Params = Values<typeof params>;

const GOAL_KEY = { doubles: "goal", threes: "goalThrees", fives: "goalFives", fibonacci: "goalFib" } as const satisfies Record<MergeId, keyof Params>;

export function rulesOf(v: Params): Rules {
  const merge = v.rule as MergeId;
  return {
    merge,
    slide: v.slide as Rules["slide"],
    entry: v.entry as Rules["entry"],
    source: v.source as Rules["source"],
    big: v.big,
    bonus: v.bonus,
    preview: v.preview,
    score: v.score as Rules["score"],
    goal: Number(v[GOAL_KEY[merge]]),
  };
}

const CLASSIC: Partial<Params> = {
  rule: "doubles", slide: "far", entry: "anywhere", source: "random", big: 10, bonus: false, preview: false, score: "merges", start: 2, blocks: 0,
};
const THREES: Partial<Params> = {
  rule: "threes", slide: "step", entry: "edge", source: "stack", bonus: true, preview: true, score: "worth", size: 4, start: 9, blocks: 0,
};

/**
 * Every published setup this game covers, by its published name. 2048's board sizes and threes'
 * goals are the setups those games offered here before they were merged.
 */
export const presets = [
  { label: "2048", params: { ...CLASSIC, size: 4, goal: "2048" } },
  { label: "2048 · 3×3 · 128", params: { ...CLASSIC, size: 3, goal: "128" } },
  { label: "2048 · 5×5 · 4096", params: { ...CLASSIC, size: 5, goal: "4096" } },
  { label: "2048 · 6×6 · 8192", params: { ...CLASSIC, size: 6, goal: "8192" } },
  { label: "threes", params: { ...THREES, goalThrees: "0" } },
  { label: "threes · make a 192", params: { ...THREES, goalThrees: "192" } },
  { label: "threes · make a 768", params: { ...THREES, goalThrees: "768" } },
  { label: "fives", params: { ...THREES, rule: "fives", goalFives: "0" } },
  { label: "1024!", params: { ...CLASSIC, size: 4, blocks: 1, goal: "1024" } },
  { label: "2584 (fibonacci 2048)", params: { ...CLASSIC, rule: "fibonacci", size: 4, goalFib: "2584" } },
] as const satisfies readonly { label: string; params: Partial<Params> }[];

/** The rules a pasted board gets for what it doesn't say: those of the first preset with its merge rule. */
const ruleDefaults = (merge: MergeId): Rules =>
  rulesOf(resolve(params, presets.find((p) => (p.params.rule ?? params.rule.default) === merge)!.params));

// --- formats ---

const seedOf = (text: string): number => {
  const h = sha1(new TextEncoder().encode(text));
  return ((h[0]! << 24) | (h[1]! << 16) | (h[2]! << 8) | h[3]!) >>> 0;
};

const KEYS = ["rule", "slide", "entry", "source", "big", "bonus", "preview", "score", "goal", "next", "deck", "seed"] as const;
const ENUMS: Partial<Record<(typeof KEYS)[number], readonly string[]>> = {
  rule: ["doubles", "threes", "fives", "fibonacci"], slide: ["far", "step"], entry: ["anywhere", "edge"], source: ["random", "stack"], score: ["merges", "worth"],
};
const onOff = (v: string, key: string): boolean => {
  if (v === "on" || v === "yes") return true;
  if (v === "off" || v === "no") return false;
  throw new Error(`${key} is on or off`);
};

/**
 * Rows of tiles (. for an empty cell, # for a block), then optional lines, one setting each:
 * `rule doubles|threes|fives|fibonacci`, `slide far|step`, `entry anywhere|edge`,
 * `source random|stack`, `big 10`, `bonus on|off`, `preview on|off`, `score merges|worth`,
 * `goal 2048|none`, `next 2` (`next +12` for a bonus tile), `deck 1 1 2 3`, `seed 12345`.
 * Without a rule line, a board with a tile 2048 can't have (a 1, a 3, …) plays by threes' rules.
 * Unset settings are that rule's usual ones; without a seed, one is made from the text, so the
 * same text always plays the same.
 */
export const gridFormat: Format<PuzzleMerge> = {
  id: "grid",
  label: "grid (rows of tiles, . for empty, # for a block)",
  detect: (t) => t.trim().includes("\n") && t.trim().split(/\r?\n/).every((l) => /^[\d.#\s]+$/.test(l) || new RegExp(`^\\s*(${KEYS.join("|")})\\s`, "i").test(l)),
  parse(text) {
    const set: Partial<Record<(typeof KEYS)[number], string>> = {};
    const rows: string[][] = [];
    for (const l of text.trim().split(/\r?\n/).map((x) => x.trim()).filter(Boolean)) {
      const m = new RegExp(`^(${KEYS.join("|")})\\s+(.+)$`, "i").exec(l);
      if (m) set[m[1]!.toLowerCase() as (typeof KEYS)[number]] = m[2]!.trim().toLowerCase();
      else rows.push(l.split(/\s+/));
    }
    for (const [k, allowed] of Object.entries(ENUMS)) {
      const v = set[k as keyof typeof set];
      if (v !== undefined && !allowed!.includes(v)) throw new Error(`${k} is one of ${allowed!.join(", ")}`);
    }
    const n = rows.length;
    if (n < 2 || n > 8 || rows.some((r) => r.length !== n)) throw new Error("the board must be square, between 2×2 and 8×8");
    const cells = rows.flat().map((t) => (t === "." || t === "0" ? 0 : t === "#" ? BLOCK : Number(t)));
    if (cells.some((v) => !Number.isInteger(v))) throw new Error("tiles are whole numbers, . for empty, # for a block");
    const nextRaw = set.next ? Number(set.next.replace("+", "")) : null;
    const tiles = [...cells.filter((v) => v > 0), ...(nextRaw ? [nextRaw] : [])];
    const merge = (set.rule as MergeId | undefined) ?? (tiles.some((v) => !isTile(MERGES.doubles, v)) ? "threes" : "doubles");
    const base = ruleDefaults(merge);
    const m = MERGES[merge];
    const rules: Rules = {
      merge,
      slide: (set.slide as Rules["slide"]) ?? base.slide,
      entry: (set.entry as Rules["entry"]) ?? base.entry,
      source: (set.source as Rules["source"]) ?? base.source,
      big: set.big !== undefined ? Number(set.big) : base.big,
      bonus: set.bonus !== undefined ? onOff(set.bonus, "bonus") : base.bonus,
      preview: set.preview !== undefined ? onOff(set.preview, "preview") : base.preview,
      score: (set.score as Rules["score"]) ?? base.score,
      goal: set.goal === undefined ? base.goal : set.goal === "none" ? 0 : Number(set.goal),
    };
    if (!Number.isInteger(rules.big) || rules.big < 0 || rules.big > 100) throw new Error("big is a percentage, 0 to 100");
    if (rules.goal && (!isTile(m, rules.goal) || m.rank(rules.goal) < 2)) throw new Error(`${set.goal} can't be a goal tile under this rule`);
    for (const v of cells) if (v > 0 && !isTile(m, v)) throw new Error(`"${v}" isn't a tile under this rule`);
    const seed = set.seed !== undefined ? Number(set.seed) >>> 0 : seedOf(text);
    const deck = set.deck ? set.deck.split(/\s+/).map(Number) : [];
    if (deck.some((v) => !m.bases.includes(v))) throw new Error(`the stack holds only ${m.bases.join(", ")}`);
    if (nextRaw !== null) {
      if (!isTile(m, nextRaw)) throw new Error(`"${set.next}" isn't a tile under this rule`);
      return { size: n, rules, start: cells, deck, next: nextRaw, bonus: set.next!.startsWith("+"), seed };
    }
    const d = deal(rules, deck, seed, best(cells));
    return { size: n, rules, start: cells, deck: d.deck, next: d.card, bonus: d.bonus, seed: d.seed };
  },
  serialize(p) {
    const width = String(best(p.start) || 1).length;
    const rows: string[] = [];
    for (let y = 0; y < p.size; y++) {
      rows.push(p.start.slice(y * p.size, y * p.size + p.size).map((v) => (v === BLOCK ? "#" : v ? String(v) : ".").padStart(width)).join(" "));
    }
    const r = p.rules;
    return [
      ...rows,
      `rule ${r.merge}`, `slide ${r.slide}`, `entry ${r.entry}`, `source ${r.source}`, `big ${r.big}`,
      `bonus ${r.bonus ? "on" : "off"}`, `preview ${r.preview ? "on" : "off"}`, `score ${r.score}`, `goal ${r.goal || "none"}`,
      `next ${p.bonus ? "+" : ""}${p.next}`, ...(p.deck.length ? [`deck ${p.deck.join(" ")}`] : []), `seed ${p.seed}`,
    ].join("\n");
  },
};

/** Cells not on the board's edge, for blocks (1024! has its block in the middle). */
const inner = (n: number): number[] => Array.from({ length: n * n }, (_, c) => c).filter((c) => c % n > 0 && c % n < n - 1 && c >= n && c < n * (n - 1));

function generate(v: Params, rng: Rng): PuzzleMerge {
  const n = v.size;
  const rules = rulesOf(v);
  const grid = Array.from({ length: n * n }, () => 0);
  const middle = rng.shuffle(inner(n));
  const blocks = Math.min(v.blocks, n * n - 2);
  for (let i = 0; i < blocks; i++) {
    const c = middle[i] ?? rng.shuffle(grid.flatMap((x, k) => (x ? [] : [k])))[0]!;
    grid[c] = BLOCK;
  }
  const open = rng.shuffle(grid.flatMap((x, c) => (x ? [] : [c])));
  let seed = rng.int(2 ** 32) >>> 0;
  let deck: number[] = [];
  const noBonus = { ...rules, bonus: false };
  for (const c of open.slice(0, Math.min(v.start, open.length - 1))) {
    const d = deal(noBonus, deck, seed, 0);
    grid[c] = d.card;
    deck = d.deck;
    seed = d.seed;
  }
  const d = deal(rules, deck, seed, best(grid));
  return { size: n, rules, start: grid, deck: d.deck, next: d.card, bonus: d.bonus, seed: d.seed };
}

const FEATURES = {
  /** The next tile is shown. */
  preview: (p: PuzzleMerge) => p.rules.preview,
  /** Two different starting tiles merge into the first rung (1 + 2 in threes, 2 + 3 in fives). */
  "starter-pair": (p: PuzzleMerge) => mergeOf(p).rank(mergeOf(p).bases[0]!) === 0,
};

declare module "../../core/types" {
  interface FeatureNames extends Ids<typeof FEATURES> {}
}

const MERGE_TEXT: Record<MergeId, string> = {
  doubles: "two equal tiles that meet merge into one with their sum.",
  threes: "a 1 and a 2 that meet merge into a 3. from 3 up, two equal tiles that meet merge into their double (3 and 3 make 6, 6 and 6 make 12).",
  fives: "a 2 and a 3 that meet merge into a 5. from 5 up, two equal tiles that meet merge into their double (5 and 5 make 10, 10 and 10 make 20).",
  fibonacci: "two tiles next to each other in the fibonacci numbers merge into their sum: 1 and 1 make 2, 1 and 2 make 3, 2 and 3 make 5, 3 and 5 make 8.",
};

const MERGE_SHORT: Record<MergeId, string> = { doubles: "equal tiles", threes: "1 + 2", fives: "2 + 3", fibonacci: "fibonacci" };

export function rulesText(p: PuzzleMerge): string[] {
  const r = p.rules, m = mergeOf(p);
  const worthFirst = m.value(1);
  return [
    r.slide === "far"
      ? "slide every tile up, down, left or right as far as it goes."
      : "every slide moves each tile one step, not all the way. a tile that is blocked stays put.",
    `${MERGE_TEXT[r.merge]}${r.slide === "far" ? " a tile merges only once per slide." : ""}`,
    ...(p.start.includes(BLOCK) ? ["a block (#) never moves: tiles stop against it, nothing merges with it and nothing lands on it."] : []),
    `after every slide that moves something, a new tile (${r.source === "stack" ? `from a stack of four of each of ${m.bases.join(", ")}` : m.bases.join(" or ")}) comes in ${r.entry === "edge" ? "at the edge you slid away from, on one of the lines that moved" : "on an empty cell"}.${r.preview ? " the board shows which tile comes next." : ""}`,
    ...(r.bonus ? [`once the biggest tile is a ${m.value(BONUS_FROM)}, now and then a bigger bonus tile comes${r.preview ? "; the board shows it only as +" : ""}.`] : []),
    r.score === "merges"
      ? "every merge scores the value of the tile it makes."
      : `a tile is worth 3 to the power of how far up it is: ${worthFirst} is worth 3, ${m.value(2)} is worth 9, ${m.value(3)} is worth 27, and so on${m.rank(m.bases[0]!) === 0 ? `; ${m.bases.filter((v) => m.rank(v) === 0).join(" and ")} are worth nothing` : ""}. the score is what all the tiles on the board are worth.`,
    r.goal ? `make a ${r.goal} tile. the game is over when no slide moves anything; once you've won you can unlock the board and keep going.` : "there's no goal: play until no slide moves anything.",
  ];
}

export const gameMerge: PuzzleDef<PuzzleMerge, StateMerge, ActionMerge, null, typeof params> = {
  id: "sliding-merge",
  name: "2048 / threes",
  aliases: ["2048", "threes", "threes!", "fives", "1024", "1024!", "2584", "fibonacci 2048", "sliding tiles game", "merge numbers"],
  tags: ["moves", "numbers", "endless", "variants"],
  description: "slide the tiles; tiles that run into each other merge. the settings cover 2048, threes and their published variants: how tiles merge, how far they slide, where new ones land, what comes next, the board and the goal.",
  generatorVersion: 1,
  params,
  presets,
  generate,
  formats: [gridFormat],
  init: (p) => ({ grid: p.start.slice(), deck: p.deck.slice(), next: p.next, bonus: p.bonus, seed: p.seed, moves: 0, score: 0 }),
  reduce,
  isSolved: (p, s) => p.rules.goal > 0 && best(s.grid) >= p.rules.goal,
  isLost: (p, s) => [0, 1, 2, 3].every((d) => !canSlide(p, s.grid, d)),
  describeAction(p, a, before, after) {
    if (a.type !== "slide") return "";
    const gained = scoreOf(p, after) - scoreOf(p, before);
    return `${DIR_NAMES[a.dir]}${gained > 0 ? ` +${gained}` : ""}`;
  },
  rules: rulesText,
  describe(p) {
    const blocks = p.start.filter((v) => v === BLOCK).length;
    return [
      `${p.size}×${p.size}`,
      MERGE_SHORT[p.rules.merge],
      ...(p.rules.slide === "step" ? ["one step"] : []),
      ...(blocks ? [`${blocks} block${blocks > 1 ? "s" : ""}`] : []),
      p.rules.goal ? `goal ${p.rules.goal}` : "until stuck",
    ].join(" · ");
  },
  features: featureTests(FEATURES),
};
