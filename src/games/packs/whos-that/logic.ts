import type { Rng } from "../../core/rng";
import { defineSchema, type Values } from "../../core/schema";
import type { Hint, PuzzleDef } from "../../core/types";
import { formatValue } from "../../lib/dataset/compare";
import { poolField, poolOf } from "../../lib/pokemon/pool";
import type { PokemonDataset, PokemonItem } from "../../lib/pokemon/types";

/** What a round shows of its pokémon. */
export const CLUES = ["silhouette", "blur", "zoom", "cry", "entry"] as const;
export type Clue = (typeof CLUES)[number];
export const CLUE_LABELS: Record<Clue, string> = { silhouette: "silhouette", blur: "blurred", zoom: "zoomed in", cry: "cry", entry: "dex entry" };
const VISUAL: readonly Clue[] = ["silhouette", "blur", "zoom"];
export const isVisual = (c: Clue): boolean => VISUAL.includes(c);

/** Further facts wrong guesses uncover, in the order they come (weakest first). */
export const EXTRAS = ["gen", "type", "genus", "letter"] as const;
export type Extra = (typeof EXTRAS)[number];

/**
 * True unless this browser says it can't play the cries (ogg vorbis; older Safari can't). Where it
 * can't, the cry clue isn't offered at all. Without an audio element (tests, workers) it is offered.
 */
export const CRIES_PLAYABLE: boolean = (() => {
  try {
    return typeof Audio === "undefined" || new Audio().canPlayType('audio/ogg; codecs="vorbis"') !== "";
  } catch {
    return true;
  }
})();

const offered = CLUES.filter((c) => c !== "cry" || CRIES_PLAYABLE);

/** How many easier steps each clue has after its first look (a wrong guess moves one step). */
export const EASE_STEPS: Record<Clue, number> = { silhouette: 4, blur: 5, zoom: 5, cry: 4, entry: 0 };

export type Game = "one" | "run" | "streak";

export const makeParams = (dataset: () => PokemonDataset | undefined) => defineSchema({
  clue: {
    type: "enum", label: "clue", default: "silhouette",
    options: [
      { value: "silhouette", label: "silhouette" },
      { value: "blur", label: "blurred picture" },
      { value: "zoom", label: "zoomed-in picture" },
      ...(CRIES_PLAYABLE ? [{ value: "cry", label: "cry" }] : []),
      { value: "entry", label: "dex entry and category" },
      { value: "mixed", label: "mixed", description: "each pokémon gets one of the clues you pick" },
    ],
  },
  mix: {
    type: "set", label: "clues to mix", default: ["silhouette", "blur", "zoom", "entry"],
    options: offered.map((c) => ({ value: c, label: CLUE_LABELS[c] })),
    when: (v) => v.clue === "mixed",
  },
  picture: {
    type: "enum", label: "picture", default: "art",
    options: [{ value: "art", label: "official artwork" }, { value: "sprite", label: "game sprite" }],
    when: (v) => v.clue === "mixed" || VISUAL.includes(v.clue as Clue),
  },
  guesses: { type: "int", label: "guesses per pokémon", default: 5, min: 1, max: 10 },
  easing: { type: "bool", label: "wrong guesses make the clue easier", default: true, description: "less dark, less blur, a wider view, a longer clip" },
  extras: {
    type: "set", label: "wrong guesses also reveal", default: ["gen", "type", "genus"],
    options: [
      { value: "gen", label: "generation" },
      { value: "type", label: "types" },
      { value: "genus", label: "category (\"Seed Pokémon\")" },
      { value: "letter", label: "first letter" },
    ],
    description: "one more after each wrong guess, in this order",
  },
  game: {
    type: "enum", label: "game", default: "one",
    options: [
      { value: "one", label: "one pokémon" },
      { value: "run", label: "a run of several" },
      { value: "streak", label: "streak: until you miss one" },
    ],
  },
  count: { type: "int", label: "pokémon in the run", default: 10, min: 2, max: 50, when: (v) => v.game === "run" },
  pool: poolField(dataset),
});

export type WhoParams = ReturnType<typeof makeParams>;

export interface WhoPuzzle {
  /** Item ids, in the order they come. */
  answers: string[];
  /** Clue of each round. */
  clues: Clue[];
  /** Where a zoomed clue looks first, per round: 0..1 through the picture's drawn pixels. */
  spots: number[];
  /** The pool query, for which names can be guessed. */
  pool: string;
  picture: "art" | "sprite";
  guesses: number;
  easing: boolean;
  extras: Extra[];
  game: Game;
}

export interface Round {
  /** Item ids guessed, in order. */
  guesses: string[];
  /** Given up on. */
  passed?: true;
}

export interface WhoState {
  /** Rounds played so far; the last is the one showing. */
  rounds: Round[];
}

export type WhoAction = { type: "guess"; id: string } | { type: "pass" } | { type: "next" };

// --- rules ---

export const named = (p: WhoPuzzle, i: number, r: Round): boolean => r.guesses.includes(p.answers[i]!);
export const wrongCount = (p: WhoPuzzle, i: number, r: Round): number => r.guesses.filter((g) => g !== p.answers[i]).length;
export const roundOver = (p: WhoPuzzle, i: number, r: Round): boolean => named(p, i, r) || !!r.passed || r.guesses.length >= p.guesses;

/** The game is over: every round played, or (streak) one missed. */
export function finished(p: WhoPuzzle, s: WhoState): boolean {
  const i = s.rounds.length - 1;
  const r = s.rounds[i]!;
  if (!roundOver(p, i, r)) return false;
  return i === p.answers.length - 1 || (p.game === "streak" && !named(p, i, r));
}

const lastNamed = (p: WhoPuzzle, s: WhoState): boolean => named(p, s.rounds.length - 1, s.rounds[s.rounds.length - 1]!);

export const namedCount = (p: WhoPuzzle, s: WhoState): number => s.rounds.filter((r, i) => roundOver(p, i, r) && named(p, i, r)).length;

/** How far the clue has eased in round `i`: one step per wrong guess (when easing), capped. */
export function easeLevel(p: WhoPuzzle, i: number, r: Round): number {
  return p.easing ? Math.min(EASE_STEPS[p.clues[i]!], wrongCount(p, i, r)) : 0;
}

/** Extras that apply to a round's clue (an entry clue already shows the category). */
export const extrasFor = (p: WhoPuzzle, i: number): Extra[] => p.extras.filter((e) => !(e === "genus" && p.clues[i] === "entry"));

/** Extras showing in round `i`: one per wrong guess. */
export const extrasShown = (p: WhoPuzzle, i: number, r: Round): Extra[] => extrasFor(p, i).slice(0, wrongCount(p, i, r));

export function reduce(p: WhoPuzzle, s: WhoState, a: WhoAction): WhoState {
  if (finished(p, s)) return s;
  const i = s.rounds.length - 1;
  const r = s.rounds[i]!;
  const over = roundOver(p, i, r);
  const put = (nr: Round): WhoState => ({ rounds: [...s.rounds.slice(0, i), nr] });
  switch (a.type) {
    case "guess":
      if (over || typeof a.id !== "string" || !a.id || r.guesses.includes(a.id)) return s;
      return put({ ...r, guesses: [...r.guesses, a.id] });
    case "pass":
      return over ? s : put({ ...r, passed: true });
    case "next":
      return over ? { rounds: [...s.rounds, { guesses: [] }] } : s;
    default:
      return s;
  }
}

// --- facts about a pokémon, for extras and hints ---

export function extraText(d: PokemonDataset, it: PokemonItem, e: Extra): string {
  const attr = (id: string) => d.attributes.find((a) => a.id === id);
  switch (e) {
    case "gen": return formatValue(attr("gen")!, it.values.gen ?? null);
    case "type": return `${formatValue(attr("type")!, it.values.type ?? null)} type`;
    case "genus": return String(it.values.genus ?? "");
    case "letter": return `starts with ${it.name.charAt(0).toUpperCase()}`;
  }
}

// --- definition ---

function generate(d: PokemonDataset, v: Values<WhoParams>, rng: Rng): WhoPuzzle {
  const kinds: Clue[] = v.clue === "mixed" ? (v.mix as readonly string[]).filter((c): c is Clue => offered.includes(c as Clue)) : [v.clue as Clue];
  if (!kinds.length) throw new Error("pick at least one clue to mix");
  if (kinds.includes("cry") && !CRIES_PLAYABLE) throw new Error("this browser can't play pokémon cries; pick another clue");
  const picture = v.picture === "sprite" ? "sprite" : "art";
  const pool = poolOf(d, v.pool).filter((it) => it.media.includes("sprite") || it.media.includes("art"));
  if (!pool.length) throw new Error("the pokémon filter leaves no pokémon with a picture");
  const game = v.game as Game;
  const n = game === "one" ? 1 : game === "run" ? Math.min(v.count, pool.length) : pool.length;
  const answers = rng.shuffle(pool.map((it) => it.id)).slice(0, n);
  const byId = new Map(pool.map((it) => [it.id, it]));
  const clues = answers.map((id) => {
    const it = byId.get(id)!;
    const ok = kinds.filter((k) => k !== "cry" || it.media.includes("cry"));
    return rng.pick(ok.length ? ok : ["entry" as const]);
  });
  const spots = answers.map(() => Math.floor(rng.next() * 1000) / 1000);
  return { answers, clues, spots, pool: v.pool, picture, guesses: v.guesses, easing: v.easing, extras: EXTRAS.filter((e) => (v.extras as readonly string[]).includes(e)), game };
}

const SQUARE = { first: "🟩", later: "🟨", missed: "🟥", wrong: "⬛" } as const;

export function makeWhoThat(dataset: () => PokemonDataset | undefined): PuzzleDef<WhoPuzzle, WhoState, WhoAction, unknown, WhoParams> {
  const data = (): PokemonDataset => {
    const d = dataset();
    if (!d) throw new Error("the pokémon data pack isn't loaded");
    return d;
  };
  const item = (id: string) => data().items().find((it) => it.id === id);
  const params = makeParams(dataset);
  const clueName = (p: WhoPuzzle) => (new Set(p.clues).size > 1 ? "mixed clues" : CLUE_LABELS[p.clues[0]!]);
  return {
    id: "whos-that",
    name: "who's that pokémon",
    aliases: ["who's that pokemon", "whos that pokemon", "pokemon silhouette", "guess the pokemon", "pokemon quiz", "pokedle silhouette"],
    tags: ["quiz", "pokémon"],
    description: "name the pokémon from one clue: its silhouette, a blurred or zoomed-in picture, its cry, or its dex entry. a wrong guess makes the clue easier.",
    datasets: ["pokemon"],
    generatorVersion: 1,
    params,
    presets: [
      { label: "silhouette", params: {} },
      { label: "silhouette, run of 10 (gen 1)", params: { game: "run", count: 10, pool: "form:default gen:1" } },
      { label: "blurred", params: { clue: "blur" } },
      { label: "zoomed in", params: { clue: "zoom" } },
      ...(CRIES_PLAYABLE ? [{ label: "cry", params: { clue: "cry" } }] : []),
      { label: "dex entry", params: { clue: "entry" } },
      { label: "mixed run of 10", params: { clue: "mixed", game: "run", count: 10 } },
      { label: "silhouette streak", params: { game: "streak", guesses: 1, easing: false, extras: [] } },
      { label: "hard: one guess, no help", params: { guesses: 1, easing: false, extras: [] } },
    ],
    daily: { params: { clue: "mixed", game: "run", count: 5 } },
    generate: (v, rng) => generate(data(), v, rng),
    formats: [],
    init: () => ({ rounds: [{ guesses: [] }] }),
    reduce,
    irreversible: true,
    // a run is played out whatever you name; one pokémon, or a streak, ends in a loss on a miss
    isSolved: (p, s) => finished(p, s) && (p.game === "run" || lastNamed(p, s)),
    isLost: (p, s) => p.game !== "run" && finished(p, s) && !lastNamed(p, s),
    solve(p, s) {
      const moves: WhoAction[] = [];
      for (let i = s.rounds.length - 1; i < p.answers.length; i++) {
        const r = i === s.rounds.length - 1 ? s.rounds[i]! : { guesses: [] };
        if (roundOver(p, i, r)) {
          if (!named(p, i, r)) return null;
        } else moves.push({ type: "guess", id: p.answers[i]! });
        if (i < p.answers.length - 1) moves.push({ type: "next" });
      }
      return { moves };
    },
    hint(p, s): Hint<WhoAction> | null {
      if (finished(p, s)) return null;
      const i = s.rounds.length - 1;
      const r = s.rounds[i]!;
      const it = item(p.answers[i]!);
      if (!it || roundOver(p, i, r)) return null;
      const shown = extrasShown(p, i, r);
      const next = EXTRAS.find((e) => !shown.includes(e) && !(e === "genus" && p.clues[i] === "entry"));
      return next ? { message: extraText(data(), it, next), level: 2 } : null;
    },
    score(p, s) {
      if (p.game === "one") {
        if (!named(p, 0, s.rounds[0]!)) return null;
        const n = s.rounds[0]!.guesses.length;
        return { value: n, label: n === 1 ? "1 guess" : `${n} guesses`, better: "lower" };
      }
      const n = namedCount(p, s);
      return p.game === "run" ? { value: n, label: `${n} of ${p.answers.length} named`, better: "higher" } : { value: n, label: n === 1 ? "streak of 1" : `streak of ${n}`, better: "higher" };
    },
    shareText(p, s) {
      const head = `Who's that pokémon? · ${clueName(p)}`;
      if (p.game === "one") {
        const r = s.rounds[0]!;
        const ok = named(p, 0, r);
        const marks = r.guesses.map((g) => (g === p.answers[0] ? SQUARE.first : SQUARE.wrong)).join("");
        return `${head} · ${ok ? `${r.guesses.length}/${p.guesses}` : `X/${p.guesses}`}\n${marks || SQUARE.missed}`;
      }
      const marks = s.rounds.filter((r, i) => roundOver(p, i, r)).map((r, i) => (!named(p, i, r) ? SQUARE.missed : r.guesses.length === 1 ? SQUARE.first : SQUARE.later));
      const n = namedCount(p, s);
      const tally = p.game === "run" ? `${n}/${p.answers.length}` : `streak ${n}`;
      const lines: string[] = [];
      for (let k = 0; k < marks.length; k += 10) lines.push(marks.slice(k, k + 10).join(""));
      return `${head} · ${tally}\n${lines.join("\n")}`;
    },
    rules: (p) => [
      p.game === "one" ? "name the pokémon from the clue." : p.game === "run" ? `name ${p.answers.length} pokémon, one after another, each from one clue.` : "name pokémon one after another until you miss one; your score is how many you named.",
      `you have ${p.guesses === 1 ? "one guess" : `${p.guesses} guesses`} for each pokémon.${p.easing && p.guesses > 1 ? " every wrong guess makes the clue easier." : ""}`,
      ...(p.extras.length && p.guesses > 1 ? [`wrong guesses also reveal, one at a time: ${p.extras.map((e) => ({ gen: "its generation", type: "its types", genus: "its category", letter: "its first letter" })[e]).join(", ")}.`] : []),
      "a dex entry has every pokémon's name blanked out.",
      "a hint tells you one more fact about it.",
    ],
    describe: (p) => `${clueName(p)}${p.game === "one" ? "" : p.game === "run" ? `, ${p.answers.length} pokémon` : ", streak"}`,
    describeAction: (p, a, before) => {
      if (a.type === "guess") return `guess ${item(a.id)?.name ?? a.id}`;
      if (a.type === "pass") return "give up on this one";
      return `on to pokémon ${before.rounds.length + 1}${p.game === "run" ? ` of ${p.answers.length}` : ""}`;
    },
  };
}

/** Pokémon names, blanked out of a dex entry. */
export const BLANK = "▬▬▬";

const blankerCache = new WeakMap<PokemonDataset, RegExp>();

/** The entry with every pokémon's name (and alias, and the answer's own form name) blanked out. */
export function redact(d: PokemonDataset, it: PokemonItem): string {
  let re = blankerCache.get(d);
  if (!re) {
    const names = new Set<string>();
    for (const x of d.items()) {
      if (x.form !== "default") continue;
      for (const n of [x.name, ...(x.aliases ?? [])]) if (n.length >= 3) names.add(n);
    }
    const alt = [...names].sort((a, b) => b.length - a.length).map((n) => n.replace(/[.*+?^${}()|[\]\\]/g, "\\$&").replace(/['’]/g, "['’]"));
    re = new RegExp(`(?<![\\p{L}\\p{N}])(?:${alt.join("|")})(?![\\p{L}\\p{N}])`, "giu");
    blankerCache.set(d, re);
  }
  const own = [it.name, ...(it.aliases ?? [])].map((n) => n.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"));
  const ownRe = new RegExp(`(?<![\\p{L}\\p{N}])(?:${own.join("|")})(?![\\p{L}\\p{N}])`, "giu");
  return String(it.values.entry ?? "").replace(ownRe, BLANK).replace(re, BLANK);
}
