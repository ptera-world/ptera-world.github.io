import { defineSchema, type FieldOption, type Values } from "../../core/schema";
import type { Dataset, Media } from "../../core/types";
import { filter } from "../../lib/dataset/query";
import { spellingLabel } from "../../lib/dataset/spelling";
import { EXTRAS, OPERATORS } from "./equations";

/** The datasets the game can be played on, looked up when needed (packs load in any order). */
export interface DataSource {
  get(id: string): Dataset | undefined;
  list(): readonly Dataset[];
}

type V = Record<string, unknown>;

/** The compare choice for spelling: no attribute id can be it (ids are letters, digits, - and _). */
export const SPELLING = "*spelling";

/** What a guess's spelling is marked with. */
export const MARKS = [
  { value: "positions", label: "each position: right, elsewhere, or absent", description: "Wordle's marks; a symbol is marked elsewhere only as many times as the answer has it" },
  { value: "greens", label: "each position: right or not", description: "no elsewhere marks" },
  { value: "killer", label: "each position: right, or not here", description: "elsewhere and absent look the same (Killer Mathler)" },
  { value: "counts", label: "counted: how many right, how many elsewhere", description: "not which ones (Mastermind's black and white pegs, Bulls and Cows, Hardle)" },
  { value: "shared", label: "counted: how many symbols are shared", description: "position ignored (Jotto)" },
  { value: "exact", label: "counted: how many are right", description: "no elsewhere count" },
  { value: "order", label: "each position: right, or the answer's comes earlier or later", description: "in alphabetical or numerical order (Word Peaks)" },
  { value: "warm", label: "each position: right, near in order, or not", description: "near: within a few places in alphabetical or numerical order (Warmle)" },
] as const;
export type MarkMode = (typeof MARKS)[number]["value"];
export const POSITIONAL = new Set<string>(["positions", "greens", "killer", "order", "warm"]);

/** Hard mode rules, by what they need from the marks. */
export const HARD_RULES = [
  { value: "keep", label: "right ones stay right", description: "a symbol (or attribute) marked right is used again in the same place (with the same value)", needs: "any" },
  { value: "use", label: "found symbols are used again", description: "each symbol marked right or elsewhere appears at least as often again", needs: "elsewhere" },
  { value: "move", label: "symbols move off places ruled out", description: "a symbol isn't put back where it was marked elsewhere or absent", needs: "elsewhere" },
  { value: "exact", label: "exact counts once known", description: "once a copy of a symbol is marked absent, it appears exactly as often as it was found", needs: "elsewhere" },
  { value: "drop", label: "absent symbols are dropped", description: "a symbol marked absent (with no copy found) isn't used again", needs: "elsewhere" },
  { value: "fit", label: "every guess could be the answer", description: "it agrees with every mark it's checked against", needs: "none" },
] as const;

const datasetOf = (data: DataSource, v: V): Dataset | undefined => (v.secret === "items" ? data.get(String(v.dataset)) : undefined);

/** Reveals: the answer's first symbol (no attribute id can be it). */
export const FIRST = "*first";

/** Ways a picture clue is shown; each wrong guess (when easing) moves one step. */
export const LOOKS = [
  { value: "silhouette", label: "a silhouette", description: "dark, lighter each step", steps: 4 },
  { value: "blur", label: "blurred", description: "sharper each step", steps: 5 },
  { value: "zoom", label: "zoomed in on a part", description: "wider each step (LoLdle's splash art)", steps: 5 },
  { value: "circle", label: "through a circle", description: "a round window on a part, larger each step", steps: 5 },
  { value: "tiles", label: "a few tiles of it", description: "the rest covered; more tiles each step", steps: 5 },
  { value: "whole", label: "as it is", description: "the whole picture", steps: 0 },
] as const;
export type Look = (typeof LOOKS)[number]["value"];

/** Steps a sound clue eases through: the share of it that plays. */
export const SOUND_STEPS = [0.25, 0.4, 0.6, 0.8, 1];

/** True if the browser says it can play this media, or can't be asked (tests). */
export function playable(m: Media): boolean {
  if (m.type !== "audio" || !m.mime) return true;
  try {
    return typeof Audio === "undefined" || new Audio().canPlayType(m.mime) !== "";
  } catch {
    return true;
  }
}

/** What an answer can be shown by: its pictures and sounds (that play here), and its text attributes. */
export interface ClueKind {
  id: string;
  label: string;
  type: "image" | "audio" | "text";
}
export function cluesOf(d: Dataset | undefined): ClueKind[] {
  if (!d) return [];
  return [
    ...Object.entries(d.media ?? {}).filter(([, m]) => playable(m)).map(([id, m]) => ({ id: `media:${id}`, label: m.label, type: m.type })),
    ...d.attributes.filter((a) => a.kind === "text").map((a) => ({ id: `text:${a.id}`, label: a.label, type: "text" as const })),
  ];
}
const hasPicture = (data: DataSource, v: V): boolean =>
  Array.isArray(v.clues) && cluesOf(datasetOf(data, v)).some((c) => c.type === "image" && (v.clues as string[]).includes(c.id));
const comparable = (d: Dataset | undefined) => (d?.attributes ?? []).filter((a) => a.kind !== "text");
/** Spelling is compared: always for codes and equations, by choice for dataset items. */
export const spelled = (v: V): boolean => v.secret !== "items" || (Array.isArray(v.compare) && v.compare.includes(SPELLING));
const symbolNoun = (v: V, data: DataSource): string => {
  if (v.secret === "codes") return String(v.symbols === "colors" ? "pegs" : v.symbols);
  if (v.secret === "equations") return "symbols";
  const d = datasetOf(data, v);
  return d ? spellingLabel(d) : "letters";
};

export function makeParams(data: DataSource) {
  return defineSchema({
    secret: {
      type: "enum", label: "what is hidden", default: "items",
      options: [
        { value: "items", label: "something from a dataset", description: "a word, a pokémon, a chess opening…: guessed by its spelling, its attributes, or both" },
        { value: "codes", label: "a code", description: "colors, digits or letters in any order (Mastermind, Bulls and Cows, Primel)" },
        { value: "equations", label: "an equation", description: "Nerdle, Mathler, Numberle" },
      ],
    },
    dataset: {
      type: "enum", label: "dataset", when: (v) => v.secret === "items",
      default: () => (data.get("words") ? "words" : data.list()[0]?.id ?? ""),
      options: () => data.list().map((d) => ({ value: d.id, label: d.name })),
    },
    pool: {
      type: "string", label: "what can be hidden", when: (v) => v.secret === "items",
      default: (v) => datasetOf(data, v)?.pools?.[0]?.query ?? "",
      placeholder: "a filter; empty: everything",
      check: (q, v) => {
        const d = datasetOf(data, v);
        if (!d) return "that dataset's pack isn't loaded";
        const r = filter(d.items(), q, d.attributes);
        return "error" in r ? r.error : `${r.items.length} ${r.items.length === 1 ? d.noun?.one ?? "item" : d.noun?.many ?? "items"}`;
      },
    },
    guess: {
      type: "enum", label: "what can be guessed", when: (v) => v.secret === "items",
      default: "all",
      options: (v): FieldOption[] => {
        const d = datasetOf(data, v);
        const noun = d?.noun?.many ?? "items";
        return [
          { value: "all", label: `any of the dataset's ${noun}` },
          { value: "pool", label: `only ${noun} that can be hidden` },
          ...(d?.spelling?.valid ? [{ value: "valid", label: `any valid ${spellingLabel(d)}`, description: "not only the dataset's own (compares spelling only)" }] : []),
        ];
      },
    },
    compare: {
      type: "set", label: "what each guess is marked on", when: (v) => v.secret === "items",
      default: (v) => {
        const d = datasetOf(data, v);
        if (!d) return [];
        return d.spelling?.primary ? [SPELLING] : (d.featured ?? comparable(d).slice(0, 6).map((a) => a.id));
      },
      options: (v): FieldOption[] => {
        const d = datasetOf(data, v);
        return [
          ...(d ? [{ value: SPELLING, label: `spelling (${spellingLabel(d)})`, description: "position by position, as Wordle marks letters" }] : []),
          ...comparable(d).map((a) => ({ value: a.id, label: a.label, ...(a.description ? { description: a.description } : {}) })),
        ];
      },
    },
    clues: {
      type: "set", label: "the answer is shown by", default: [], when: (v) => v.secret === "items",
      options: (v): FieldOption[] => cluesOf(datasetOf(data, v)).map((c) => ({ value: c.id, label: c.label })),
      description: "each answer is shown by one of these, picked at random; nothing: shown by nothing (who's that pokémon, Pokédle's silhouette, LoLdle's splash art)",
    },
    looks: {
      type: "set", label: "a picture is shown", default: ["silhouette"], when: (v) => hasPicture(data, v),
      options: LOOKS.map(({ value, label, description }) => ({ value, label, description })),
      description: "each picture is shown one of these ways, picked at random",
    },
    ease: { type: "bool", label: "each wrong guess shows more of it", default: true, when: (v) => Array.isArray(v.clues) && v.clues.length > 0, description: "less dark, less blur, a wider view, a longer clip" },
    reveals: {
      type: "set", label: "wrong guesses also reveal", default: [], when: (v) => v.secret === "items",
      options: (v): FieldOption[] => [
        ...(datasetOf(data, v)?.attributes ?? []).map((a) => ({ value: a.id, label: a.label })),
        { value: FIRST, label: "the first letter" },
      ],
      description: "one more after each wrong guess, in this order (Pokédle's and LoLdle's clues)",
    },
    symbols: {
      type: "enum", label: "made of", default: "colors", when: (v) => v.secret === "codes",
      options: [{ value: "colors", label: "colors" }, { value: "digits", label: "digits" }, { value: "letters", label: "letters" }],
    },
    alphabet: {
      type: "int", label: "how many to choose from", min: 2, max: 26, when: (v) => v.secret === "codes",
      default: (v) => (v.symbols === "digits" ? 10 : 6),
    },
    distinct: { type: "bool", label: "no symbol twice", default: false, when: (v) => v.secret === "codes", description: "in the code and in guesses (Bulls and Cows, Bagels)" },
    blanks: { type: "bool", label: "blank places allowed in guesses", default: false, when: (v) => v.secret === "codes", description: "a blank is never marked" },
    prime: { type: "bool", label: "primes only", default: false, when: (v) => v.secret === "codes" && v.symbols === "digits", description: "the code and every guess is a prime with no leading zero (Primel)" },
    ops: {
      type: "set", label: "symbols besides digits", when: (v) => v.secret === "equations",
      default: [...OPERATORS],
      options: [...OPERATORS, ...EXTRAS].map((o) => ({ value: o, label: o })),
    },
    form: {
      type: "enum", label: "what is guessed", default: "number", when: (v) => v.secret === "equations",
      options: [
        { value: "number", label: "an equation with a number on the right", description: "e.g. 12+46=58 (Nerdle, Numberle)" },
        { value: "target", label: "a calculation equal to a given number", description: "the number is shown (Mathler)" },
      ],
    },
    commutative: { type: "bool", label: "rearranged answers count", default: true, when: (v) => v.secret === "equations", description: "20+10=30 solves 10+20=30" },
    minLen: {
      type: "int", label: "shortest", min: 1, max: 40, when: spelled,
      default: (v) => (v.secret === "codes" ? 4 : v.secret === "equations" ? 8 : datasetOf(data, v)?.spelling?.lengths?.min ?? 5),
    },
    maxLen: {
      type: "int", label: "longest", min: 1, max: 40, when: spelled,
      default: (v) => Math.max(Number(v.minLen), v.secret === "items" ? datasetOf(data, v)?.spelling?.lengths?.max ?? 5 : Number(v.minLen)),
    },
    marks: {
      type: "enum", label: "how a spelling is marked", when: spelled, options: [...MARKS],
      default: (v) => (v.secret === "codes" && v.symbols === "colors" ? "counts" : "positions"),
    },
    near: { type: "int", label: "near: within how many places", min: 1, max: 10, default: 3, when: (v) => spelled(v) && v.marks === "warm" },
    slots: {
      type: "bool", label: "lists in order are marked slot by slot", default: false,
      when: (v) => v.secret === "items" && comparable(datasetOf(data, v)).some((a) => a.kind === "set" && a.ordered && (v.compare as string[]).includes(a.id)),
      description: "right slot, the other slot, or not at all (Squirdle's types)",
    },
    close: {
      type: "set", label: "close counts on", default: [],
      when: (v) => v.secret === "items" && comparable(datasetOf(data, v)).some((a) => (a.kind === "number" || a.kind === "ordinal") && (v.compare as string[]).includes(a.id)),
      options: (v) => comparable(datasetOf(data, v)).filter((a) => (a.kind === "number" || a.kind === "ordinal") && (v.compare as string[]).includes(a.id)).map((a) => ({ value: a.id, label: a.label })),
      description: "a wrong value within the distance below is marked close (Poeltl, Weddle)",
    },
    within: { type: "int", label: "close within", min: 1, max: 1000, default: 2, when: (v) => Array.isArray(v.close) && v.close.length > 0 },
    by: {
      type: "enum", label: "counted as", default: "amount", when: (v) => Array.isArray(v.close) && v.close.length > 0,
      options: [{ value: "amount", label: "an amount (or steps)" }, { value: "percent", label: "a percentage of the answer's value" }],
    },
    boards: { type: "int", label: "boards", default: 1, min: 1, max: 1024, description: "each guess counts on every board (Dordle, Quordle, Octordle, Sedecordle, Duotrigordle, Kilordle)", when: (v) => v.split === "" || v.split === undefined },
    split: {
      type: "enum", label: "one board per", default: "", when: (v) => v.secret === "items",
      options: (v) => [{ value: "", label: "nothing: boards as above" }, ...comparable(datasetOf(data, v)).filter((a) => a.kind !== "number").map((a) => ({ value: a.id, label: a.label }))],
    },
    split2: {
      type: "enum", label: "and per", default: "", when: (v) => v.secret === "items" && v.split !== "",
      options: (v) => [{ value: "", label: "nothing (a row of boards)" }, ...comparable(datasetOf(data, v)).filter((a) => a.kind !== "number" && a.id !== v.split).map((a) => ({ value: a.id, label: a.label }))],
    },
    open: {
      type: "enum", label: "boards open", default: "together", when: (v) => Number(v.boards) > 1 || v.split !== "",
      options: [
        { value: "together", label: "all at once" },
        { value: "sequence", label: "one at a time, sharing the guesses", description: "the next opens when one is found, with every guess so far marked on it (Quordle sequence)" },
        { value: "rounds", label: "one at a time, each with its own guesses", description: "a run of rounds: found or missed, on to the next (who's that pokémon runs)" },
      ],
    },
    streak: { type: "bool", label: "a missed round ends the game", default: false, when: (v) => v.open === "rounds", description: "a streak: score is how many you found" },
    pair: {
      type: "bool", label: "two answers per board", default: false, when: (v) => spelled(v) && POSITIONAL.has(String(v.marks)),
      description: "sharing no symbols; each mark is the better of the two; find both (Xordle)",
    },
    limit: {
      type: "int", label: "guesses (0: no limit)", min: 0, max: 5000,
      description: "for all the boards together; with rounds, for each round",
      default: (v) => {
        const n = Number(v.boards) || 1;
        if (v.secret === "codes") return 10;
        if (v.secret === "items" && Array.isArray(v.compare) && !v.compare.length) return 5;
        if (v.open === "rounds") return 6;
        if (v.secret === "items" && !spelled(v)) return 0;
        return n + 5;
      },
    },
    overtime: { type: "bool", label: "keep guessing after the last guess", default: false, when: (v) => Number(v.limit) > 0 && v.open !== "rounds", description: "finish the boards anyway; it still counts as lost" },
    starters: { type: "int", label: "guesses filled in at random to start", min: 0, max: 20, default: 0, description: "they count toward the limit (Quordle's rescue, Duotrigordle's jumble)" },
    lies: {
      type: "enum", label: "false marks", default: "none", when: (v) => spelled(v) && POSITIONAL.has(String(v.marks)) && v.answer !== "dodge",
      options: [{ value: "none", label: "none" }, { value: "one", label: "one per row", description: "one mark in each row is wrong, except on the row that finds the answer (Fibble)" }],
    },
    answer: {
      type: "enum", label: "the answer", default: "fixed", when: (v) => v.secret !== "equations" && v.lies !== "one" && !v.pair,
      options: [
        { value: "fixed", label: "is chosen at the start" },
        { value: "dodge", label: "dodges your guesses", description: "after each guess it is whatever keeps the most possibilities open (Absurdle, Evil Wordle)" },
      ],
    },
    hard: {
      type: "set", label: "hard mode", default: [],
      options: (v) => HARD_RULES.filter((r) => r.needs === "none" || (r.needs === "any" ? !spelled(v) || POSITIONAL.has(String(v.marks)) : spelled(v) && v.marks === "positions")).map(({ value, label, description }) => ({ value, label, description })),
    },
    hardRows: {
      type: "enum", label: "hard mode checks", default: "last", when: (v) => Array.isArray(v.hard) && v.hard.length > 0,
      options: [{ value: "last", label: "the guess before", description: "as in Wordle" }, { value: "all", label: "every guess so far", description: "as in Hello Wordl and Survivle" }],
    },
    goal: {
      type: "enum", label: "goal", default: "find",
      options: [
        { value: "find", label: "find the answer" },
        { value: "avoid", label: "avoid it", description: "the game ends when you guess it; score: guesses before that (Antiwordle, Survivle)" },
      ],
    },
    reveal: { type: "bool", label: "the first symbol is shown", default: false, when: spelled, description: "as in Lingo" },
  });
}

export type Params = ReturnType<typeof makeParams>;
export type Settings = Values<Params>;

/** What a spelling's symbols are called for these settings ("letters", "moves", "pegs"…). */
export const symbolsName = symbolNoun;
