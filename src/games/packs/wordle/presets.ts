import type { Preset } from "../../core/types";
import { RANK, SPELLING, type DataSource, type Params } from "./params";

/**
 * Named setups of games people know, each only settings of this one game. A setup on a dataset is
 * offered while that dataset's pack is loaded. Guess limits and board counts are each game's own.
 */
const ON_WORDS: readonly Preset<Params>[] = [
  { label: "Wordle", params: {} },
  { label: "Wordle, hard mode", params: { hard: ["keep", "use"] } },
  { label: "Hello Wordl: 4 to 11 letters", params: { minLen: 4, maxLen: 11 } },
  { label: "Hello Wordl, ultra hard", params: { hard: ["keep", "use", "move", "exact"], hardRows: "all" } },
  { label: "Dordle (2 boards)", params: { boards: 2, limit: 7 } },
  { label: "Quordle (4 boards)", params: { boards: 4, limit: 9 } },
  { label: "Quordle sequence", params: { boards: 4, limit: 10, open: "sequence" } },
  { label: "Quordle rescue", params: { boards: 4, limit: 9, starters: 2 } },
  { label: "Octordle (8 boards)", params: { boards: 8, limit: 13 } },
  { label: "Octordle sequence", params: { boards: 8, limit: 15, open: "sequence" } },
  { label: "Octordle rescue", params: { boards: 8, limit: 13, starters: 4 } },
  { label: "Sedecordle (16 boards)", params: { boards: 16, limit: 21 } },
  { label: "Duotrigordle (32 boards)", params: { boards: 32, limit: 37 } },
  { label: "Duotrigordle sequence", params: { boards: 32, limit: 39, open: "sequence" } },
  { label: "Duotrigordle jumble", params: { boards: 32, limit: 38, starters: 3 } },
  { label: "64ordle (64 boards)", params: { boards: 64, limit: 70 } },
  { label: "Kilordle (1000 boards)", params: { boards: 1000, limit: 1005 } },
  { label: "Absurdle", params: { answer: "dodge", limit: 0 } },
  { label: "Absurdle, hard", params: { answer: "dodge", limit: 0, hard: ["fit"] } },
  { label: "Fibble (one false mark per row)", params: { lies: "one", limit: 9, starters: 1 } },
  { label: "Fibble, hard", params: { lies: "one", limit: 9, starters: 1, hard: ["fit"], hardRows: "all" } },
  { label: "Xordle (two answers, no letters shared)", params: { pair: true, limit: 9, starters: 1 } },
  { label: "Antiwordle (avoid the word)", params: { goal: "avoid", limit: 0, hard: ["keep", "use", "drop"] } },
  { label: "Survivle", params: { goal: "avoid", limit: 0, hard: ["keep", "use", "move", "exact"], hardRows: "all" } },
  { label: "Hardle (counts only)", params: { marks: "counts", limit: 10 } },
  { label: "Jotto (shared letters)", params: { marks: "shared", limit: 0 } },
  { label: "Word Peaks (earlier or later)", params: { marks: "order" } },
  { label: "Warmle (near in the alphabet)", params: { marks: "warm", near: 3, starters: 1 } },
  { label: "greens only", params: { marks: "greens", limit: 8 } },
  { label: "Lingo (first letter shown, 5 guesses)", params: { reveal: true, limit: 5 } },
];

const CODES: readonly Preset<Params>[] = [
  { label: "Mastermind (6 colors, 4 pegs)", params: { secret: "codes", symbols: "colors", alphabet: 6, minLen: 4, maxLen: 4, marks: "counts", limit: 10 } },
  { label: "Super Mastermind (8 colors, 5 pegs)", params: { secret: "codes", symbols: "colors", alphabet: 8, minLen: 5, maxLen: 5, marks: "counts", limit: 12 } },
  { label: "Mastermind, marks on each peg", params: { secret: "codes", symbols: "colors", alphabet: 6, minLen: 4, maxLen: 4, marks: "positions", limit: 10 } },
  { label: "Mastermind, blanks allowed", params: { secret: "codes", symbols: "colors", alphabet: 6, minLen: 4, maxLen: 4, marks: "counts", limit: 10, blanks: true } },
  { label: "Bulls and Cows (4 different digits)", params: { secret: "codes", symbols: "digits", alphabet: 10, distinct: true, minLen: 4, maxLen: 4, marks: "counts", limit: 0 } },
  { label: "Pico Fermi Bagels (3 different digits)", params: { secret: "codes", symbols: "digits", alphabet: 10, distinct: true, minLen: 3, maxLen: 3, marks: "counts", limit: 10 } },
  { label: "Primel (a 5-digit prime)", params: { secret: "codes", symbols: "digits", alphabet: 10, prime: true, minLen: 5, maxLen: 5, marks: "positions", limit: 6 } },
];

const EQUATIONS: readonly Preset<Params>[] = [
  { label: "Nerdle (8 symbols)", params: { secret: "equations", minLen: 8, maxLen: 8, limit: 6 } },
  { label: "Micro Nerdle (5)", params: { secret: "equations", minLen: 5, maxLen: 5, limit: 6 } },
  { label: "Mini Nerdle (6)", params: { secret: "equations", minLen: 6, maxLen: 6, limit: 6 } },
  { label: "Midi Nerdle (7)", params: { secret: "equations", minLen: 7, maxLen: 7, limit: 6 } },
  { label: "Maxi Nerdle (10, brackets and powers)", params: { secret: "equations", minLen: 10, maxLen: 10, limit: 6, ops: ["+", "-", "*", "/", "(", ")", "²", "³"] } },
  { label: "Bi-Nerdle (2 boards)", params: { secret: "equations", minLen: 8, maxLen: 8, boards: 2, limit: 7 } },
  { label: "Quad Nerdle (4 boards)", params: { secret: "equations", minLen: 8, maxLen: 8, boards: 4, limit: 10 } },
  { label: "Numberle (no rearranging)", params: { secret: "equations", minLen: 8, maxLen: 8, limit: 6, commutative: false } },
  { label: "Mathler (reach the number)", params: { secret: "equations", form: "target", minLen: 6, maxLen: 6, limit: 6 } },
  { label: "Killer Mathler", params: { secret: "equations", form: "target", minLen: 6, maxLen: 6, limit: 6, marks: "killer" } },
];

/** Who's that pokémon: shown by a clue, marked only right or wrong; each over the defaults in ON.pokemon. */
const WHOS_THAT: readonly { label: string; params: Record<string, unknown> }[] = [
  { label: "who's that pokémon? (silhouette)", params: {} },
  { label: "who's that pokémon? run of 10, gen 1", params: { open: "rounds", boards: 10, pool: "form:default gen:1" } },
  { label: "who's that pokémon? blurred", params: { looks: ["blur"] } },
  { label: "who's that pokémon? zoomed in", params: { looks: ["zoom"] } },
  { label: "who's that pokémon? through a circle", params: { looks: ["circle"] } },
  { label: "who's that pokémon? a few tiles", params: { looks: ["tiles"] } },
  { label: "who's that pokémon? by its cry", params: { clues: ["media:cry"] } },
  { label: "who's that pokémon? by its dex entry", params: { clues: ["text:entry"], reveals: ["gen", "type"] } },
  { label: "who's that pokémon? mixed run of 10", params: { open: "rounds", boards: 10, clues: ["media:art", "media:cry", "text:entry"], looks: ["silhouette", "blur", "zoom", "circle", "tiles"] } },
  { label: "who's that pokémon? silhouette streak", params: { open: "rounds", streak: true, boards: 1024, limit: 1, ease: false, reveals: [] } },
];

/** Setups on one dataset, by its id: offered while it's loaded. */
const ON: Record<string, readonly Preset<Params>[]> = {
  pokemon: [
    { label: "Pokédle", params: { secret: "items", dataset: "pokemon", compare: ["type", "gen", "stage", "color", "height", "weight"], limit: 0 } },
    { label: "Squirdle", params: { secret: "items", dataset: "pokemon", compare: ["gen", "type", "height", "weight"], slots: true, limit: 8 } },
    { label: "pokémon names, Wordle's way", params: { secret: "items", dataset: "pokemon", compare: [SPELLING], minLen: 4, maxLen: 8, limit: 6 } },
    { label: "pokémon: one board per type", params: { secret: "items", dataset: "pokemon", compare: ["type", "gen", "stage", "color", "height", "weight"], split: "type", limit: 0 } },
    { label: "pokémon: generation × type", params: { secret: "items", dataset: "pokemon", pool: "form:default gen:1-3", compare: ["type", "gen", "stage", "color", "height", "weight"], split: "gen", split2: "type", limit: 0 } },
    ...WHOS_THAT.map((x) => ({ label: x.label, params: { secret: "items", dataset: "pokemon", compare: [], clues: ["media:art"], reveals: ["gen", "type", "genus"], limit: 5, ...x.params } })),
    { label: "pokémon Contexto: how alike is each guess", params: { secret: "items", dataset: "pokemon", pool: "form:default", guess: "pool", compare: [RANK], limit: 0 } },
    { label: "pokémon Contexto, gen 1", params: { secret: "items", dataset: "pokemon", pool: "form:default gen:1", guess: "pool", compare: [RANK], limit: 0 } },
    { label: "pokémon Contexto, alike by looks", params: { secret: "items", dataset: "pokemon", pool: "form:default", guess: "pool", compare: [RANK], alike: "looks", limit: 0 } },
    { label: "pokémon Contexto, alike in battle", params: { secret: "items", dataset: "pokemon", pool: "form:default", guess: "pool", compare: [RANK], alike: "battle", limit: 0 } },
    { label: "Pokédle with its silhouette", params: { secret: "items", dataset: "pokemon", compare: ["type", "gen", "stage", "color", "height", "weight"], clues: ["media:art"], looks: ["silhouette"], limit: 0 } },
  ],
  openings: [
    { label: "chess openings: guess the moves", params: { secret: "items", dataset: "openings", compare: [SPELLING], guess: "valid", limit: 6 } },
    { label: "chess openings: guess the line by its facts", params: { secret: "items", dataset: "openings", compare: ["eco", "family", "first", "plies"], limit: 0 } },
  ],
};

export function presetsFor(data: DataSource): Preset<Params>[] {
  const words = data.get("words") ? ON_WORDS.map((p) => ({ ...p, params: { secret: "items", dataset: "words", ...p.params } })) : [];
  const sets = Object.entries(ON).flatMap(([id, list]) => (data.get(id) ? list : []));
  // every other dataset, at its own defaults
  const rest = data.list().filter((d) => d.id !== "words" && !(d.id in ON)).map((d) => ({ label: d.name, params: { secret: "items", dataset: d.id } }));
  return [...words, ...CODES, ...EQUATIONS, ...sets, ...rest] as Preset<Params>[];
}
