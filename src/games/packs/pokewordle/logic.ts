import type { Rng } from "../../core/rng";
import { defineSchema, type Values } from "../../core/schema";
import type { PuzzleDef } from "../../core/types";
import { normalizeName } from "../../lib/dataset/names";
import { filter } from "../../lib/dataset/query";
import { poolField } from "../../lib/pokemon/pool";
import type { PokemonDataset, PokemonItem } from "../../lib/pokemon/types";

/**
 * Wordle on pokémon names. A name's word is its letters only, lower case, accents dropped
 * (Farfetch’d: farfetchd, Nidoran♀: nidoranf); names with digits (Porygon2) have no word.
 */

export interface WordlePuzzle {
  /** The pool filter answers come from (also what "names that still fit" counts). */
  pool: string;
  /** Item id of the answer. */
  answer: string;
  guesses: number;
  hard: boolean;
}

/** Mark of one letter: not in the name (beyond those already marked), in it elsewhere, right here. */
export const ABSENT = 0, ELSEWHERE = 1, RIGHT = 2;

export interface Marked {
  word: string;
  marks: number[];
}

export interface WordleState {
  done: Marked[];
  /** The guess being typed, one letter per position, "" for empty. */
  row: string[];
  /**
   * Where the next typed letter goes. Typing writes there and moves on, over letters already in
   * place (a settled letter filled in ahead is typed over as the player spells the name out).
   */
  at: number;
}

export type WordleAction =
  | { type: "letter"; ch: string }
  | { type: "back" }
  | { type: "row"; row: string[] }
  | { type: "submit" };

/** Hint focus: positions of the current row, and marked guesses. */
export interface WordleFocus {
  slots: number[];
  rows: number[];
}

export function makeParams(dataset: () => PokemonDataset | undefined) {
  return defineSchema({
    pool: poolField(dataset, "which pokémon can be the answer"),
    minLen: { type: "int", label: "shortest name", default: 4, min: 3, max: 12 },
    maxLen: { type: "int", label: "longest name", default: 8, min: 3, max: 12 },
    guesses: { type: "int", label: "guesses", default: 6, min: 1, max: 12 },
    hard: { type: "bool", label: "hard mode", default: false, description: "letters found right must stay in place, and letters found elsewhere must be used again" },
  });
}
export type WordleParams = ReturnType<typeof makeParams>;

export const wordOf = (name: string): string | null => {
  const w = normalizeName(name);
  return /^[a-z]+$/.test(w) ? w : null;
};

/** Wordle's marks: right places first, then each other letter is "elsewhere" while the answer has unmarked copies of it left. */
export function markWord(guess: string, answer: string): number[] {
  const out: number[] = Array.from(guess, (c, i) => (c === answer[i] ? RIGHT : ABSENT));
  const left = new Map<string, number>();
  for (let i = 0; i < answer.length; i++) if (out[i] !== RIGHT) left.set(answer[i]!, (left.get(answer[i]!) ?? 0) + 1);
  for (let i = 0; i < guess.length; i++) {
    if (out[i] === RIGHT) continue;
    const n = left.get(guess[i]!) ?? 0;
    if (n > 0) { out[i] = ELSEWHERE; left.set(guess[i]!, n - 1); }
  }
  return out;
}

export const fits = (g: Marked, word: string): boolean => markWord(g.word, word).every((m, i) => m === g.marks[i]);

const ordinal = (i: number) => `${i + 1}${i === 0 ? "st" : i === 1 ? "nd" : i === 2 ? "rd" : "th"}`;

/** Why hard mode refuses `word` after `done`, or null. Greens stay put; every found letter is used at least as often as one guess showed it. */
export function hardModeError(done: readonly Marked[], word: string): string | null {
  for (const g of done) {
    for (let i = 0; i < g.word.length; i++) if (g.marks[i] === RIGHT && word[i] !== g.word[i]) return `the ${ordinal(i)} letter must be ${g.word[i]!.toUpperCase()}`;
  }
  for (const g of done) {
    const need = new Map<string, number>();
    g.word.split("").forEach((c, i) => { if (g.marks[i]) need.set(c, (need.get(c) ?? 0) + 1); });
    for (const [c, n] of need) {
      const have = word.split("").filter((x) => x === c).length;
      if (have < n) return n > 1 ? `the name must have ${n} ${c.toUpperCase()}s` : `the name must have ${c.toUpperCase()}`;
    }
  }
  return null;
}

/** Everything the rules need from the dataset, cached per dataset. */
export interface Words {
  /** Every pokémon's word: what can be guessed. */
  valid: Set<string>;
  /** Word → the name it comes from (the first item with it). */
  names: Map<string, PokemonItem>;
  /** Words of the pool, by filter, sorted. */
  pool(query: string): string[];
  byId: Map<string, PokemonItem>;
}

const wordsCache = new WeakMap<PokemonDataset, Words>();
export function wordsOf(d: PokemonDataset): Words {
  let w = wordsCache.get(d);
  if (w) return w;
  const names = new Map<string, PokemonItem>();
  for (const it of d.items()) {
    const x = wordOf(it.name);
    if (x && !names.has(x)) names.set(x, it);
  }
  const pools = new Map<string, string[]>();
  w = {
    valid: new Set(names.keys()),
    names,
    byId: new Map(d.items().map((it) => [it.id, it])),
    pool(query) {
      let list = pools.get(query);
      if (!list) {
        const r = filter(d.items(), query, d.attributes);
        list = "error" in r ? [] : [...new Set(r.items.flatMap((it) => wordOf(it.name) ?? []))].sort();
        pools.set(query, list);
      }
      return list;
    },
  };
  wordsCache.set(d, w);
  return w;
}

export function answerWord(words: Words, p: WordlePuzzle): string {
  const it = words.byId.get(p.answer);
  const w = it ? wordOf(it.name) : null;
  if (!w) throw new Error(`the answer "${p.answer}" isn't in the pokémon data`);
  return w;
}

/** Pool words of the answer's length that agree with every mark so far. */
export function candidates(words: Words, p: WordlePuzzle, s: WordleState): string[] {
  const len = s.row.length;
  return words.pool(p.pool).filter((w) => w.length === len && s.done.every((g) => fits(g, w)));
}

export const isSolved = (s: WordleState): boolean => s.done.length > 0 && s.done[s.done.length - 1]!.marks.every((m) => m === RIGHT);
export const isOver = (p: WordlePuzzle, s: WordleState): boolean => isSolved(s) || s.done.length >= p.guesses;

/** Why the row can't be handed in, or null. */
export function submitError(words: Words, p: WordlePuzzle, s: WordleState): string | null {
  if (s.row.some((c) => !c)) return "not enough letters";
  const word = s.row.join("");
  if (!words.valid.has(word)) return "not a pokémon name";
  if (p.hard) return hardModeError(s.done, word);
  return null;
}

export function reduce(words: Words, p: WordlePuzzle, s: WordleState, a: WordleAction): WordleState {
  if (isOver(p, s)) return s;
  switch (a.type) {
    case "letter": {
      if (s.at >= s.row.length || !/^[a-z]$/.test(a.ch)) return s;
      const row = s.row.slice();
      row[s.at] = a.ch;
      return { ...s, row, at: s.at + 1 };
    }
    case "back": {
      if (s.at === 0) return s;
      const row = s.row.slice();
      row[s.at - 1] = "";
      return { ...s, row, at: s.at - 1 };
    }
    case "row": {
      if (a.row.length !== s.row.length || a.row.some((c) => c !== "" && !/^[a-z]$/.test(c)) || a.row.every((c, i) => c === s.row[i])) return s;
      return { ...s, row: a.row.slice() };
    }
    case "submit": {
      if (submitError(words, p, s)) return s;
      const word = s.row.join("");
      return { done: [...s.done, { word, marks: markWord(word, answerWord(words, p)) }], row: s.row.map(() => ""), at: 0 };
    }
    default:
      return s;
  }
}

export function generate(d: PokemonDataset, v: Values<WordleParams>, rng: Rng): WordlePuzzle {
  const r = filter(d.items(), v.pool, d.attributes);
  if ("error" in r) throw new Error(`the pokémon filter: ${r.error}`);
  const lo = Math.min(v.minLen, v.maxLen), hi = Math.max(v.minLen, v.maxLen);
  const byWord = new Map<string, string>();
  for (const it of r.items) {
    const w = wordOf(it.name);
    if (w && w.length >= lo && w.length <= hi && !byWord.has(w)) byWord.set(w, it.id);
  }
  const list = [...byWord.keys()].sort();
  if (!list.length) throw new Error(`no pokémon in the filter has a name of ${lo === hi ? lo : `${lo} to ${hi}`} letters`);
  return { pool: v.pool, answer: byWord.get(rng.pick(list))!, guesses: v.guesses, hard: v.hard };
}

export const SQUARES = ["⬛", "🟨", "🟩"] as const;

export function makeDef(dataset: () => PokemonDataset | undefined): PuzzleDef<WordlePuzzle, WordleState, WordleAction, null, WordleParams> {
  const need = (): PokemonDataset => {
    const d = dataset();
    if (!d) throw new Error("the pokémon data pack isn't loaded");
    return d;
  };
  const words = () => wordsOf(need());
  const len = (p: WordlePuzzle) => answerWord(words(), p).length;
  return {
    id: "pokewordle",
    name: "name wordle",
    aliases: ["pokémon wordle", "pokewordle", "wordle"],
    tags: ["pokémon", "deduction", "words"],
    description: "guess the hidden pokémon's name. each guess must be a pokémon name of the same length; its letters show which are right, which are in the name elsewhere, and which aren't in it.",
    datasets: ["pokemon"],
    generatorVersion: 1,
    params: makeParams(dataset),
    presets: [
      { label: "every species, 4–8 letters", params: {} },
      { label: "generation 1", params: { pool: "form:default gen:1" } },
      { label: "gens 1–4", params: { pool: "form:default gen:1-4" } },
      { label: "five letters", params: { minLen: 5, maxLen: 5 } },
      { label: "long names (9–12 letters)", params: { minLen: 9, maxLen: 12 } },
      { label: "hard mode", params: { hard: true } },
    ],
    daily: { params: {} },
    generate: (v, rng) => generate(need(), v, rng),
    formats: [],
    init: (p) => ({ done: [], row: Array.from({ length: len(p) }, () => ""), at: 0 }),
    reduce: (p, s, a) => reduce(words(), p, s, a),
    isSolved: (_p, s) => isSolved(s),
    isLost: (p, s) => !isSolved(s) && s.done.length >= p.guesses,
    isRetraction: (a) => a.type === "back",
    // marks once seen can't be taken back by undoing the guess
    irreversible: true,
    solve: (p, s) => (s.done.length < p.guesses ? { moves: [{ type: "row", row: answerWord(words(), p).split("") }, { type: "submit" }] } : null),
    hint: (p, s) => {
      if (isOver(p, s)) return null;
      const n = candidates(words(), p, s).length;
      const L = s.row.length;
      return {
        message: s.done.length
          ? `${n} ${n === 1 ? "name" : "names"} of ${L} letters still ${n === 1 ? "fits" : "fit"} every mark`
          : `${n} names of ${L} letters can be the answer`,
        focus: { slots: [], rows: s.done.map((_, i) => i) } satisfies WordleFocus,
      };
    },
    describeAction: (_p, a, _b, after) => {
      switch (a.type) {
        case "letter": return `type ${a.ch.toUpperCase()}`;
        case "back": return "delete a letter";
        case "row": return `type ${a.row.map((c) => c.toUpperCase() || "_").join("")}`;
        case "submit": {
          const g = after.done[after.done.length - 1];
          return g ? `guess ${g.word.toUpperCase()}` : "guess";
        }
      }
    },
    describe: (p) => `${len(p)} letters${p.hard ? ", hard" : ""}`,
    rules: (p) => [
      `guess the hidden pokémon in ${p.guesses} tries. its name has ${len(p)} letters (letters only: Mr. Mime is MRMIME, Farfetch’d is FARFETCHD).`,
      "every guess must be a pokémon name with that many letters.",
      "each letter of a guess turns green if it is in that place in the name, yellow if the name has it somewhere else, gray if not. a letter guessed twice is yellow twice only if the name has it twice.",
      ...(p.hard ? ["hard mode: green letters must stay in place, and yellow letters must be used again."] : []),
    ],
    score: (p, s) => (isSolved(s) ? { value: s.done.length, label: `${s.done.length}/${p.guesses}`, better: "lower" } : null),
    shareText: (p, s) => {
      const head = `name wordle ${isSolved(s) ? s.done.length : "X"}/${p.guesses}${p.hard ? "*" : ""} · ${len(p)} letters`;
      return [head, "", ...s.done.map((g) => g.marks.map((m) => SQUARES[m]).join(""))].join("\n");
    },
    rate: (p) => {
      const n = words().pool(p.pool).filter((w) => w.length === len(p)).length;
      return { label: `${n} names of ${len(p)} letters`, score: Math.log2(Math.max(2, n)) / p.guesses };
    },
  };
}
