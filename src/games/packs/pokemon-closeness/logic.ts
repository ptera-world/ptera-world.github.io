import type { Rng } from "../../core/rng";
import { defineSchema, type Values } from "../../core/schema";
import type { Hint, PuzzleDef } from "../../core/types";
import { poolField, poolOf } from "../../lib/pokemon/pool";
import type { PokemonDataset, PokemonItem } from "../../lib/pokemon/types";
import { closeness, PROFILES, resolveWeights, Space, type Closeness } from "./similarity";

export interface ClosenessPuzzle {
  /** Pool filter (lib/dataset/query): what can be guessed, and what ranks count among. */
  pool: string;
  /** Item id of the hidden pokémon. */
  answer: string;
  /** Attribute id (or "family") → weight, already resolved. */
  weights: Record<string, number>;
}

export interface ClosenessState {
  /** Item ids guessed, oldest first. */
  guesses: string[];
  /** Guesses a hint made. */
  hinted: string[];
  /** The answer was shown rather than found. */
  revealed?: boolean;
}

export type ClosenessAction =
  | { type: "guess"; id: string; hint?: boolean }
  | { type: "reveal" };

/** Everything derived from a puzzle and the dataset: the pool, its distances, each item's closeness. */
export interface Scored {
  items: readonly PokemonItem[];
  index: ReadonlyMap<string, number>;
  space: Space;
  answer: number;
  close: readonly Closeness[];
  /** Same for the same dataset version, pool and weights: names the map in caches. */
  mapKey: string;
}

/** Closeness bands, as fractions of the way down the ranking: shared by the list, map and share text. */
export type Band = "found" | "hot" | "warm" | "cold";
export function bandOf(rank: number, n: number): Band {
  if (rank === 1) return "found";
  const q = (rank - 1) / Math.max(1, n - 1);
  return q <= 0.03 ? "hot" : q <= 0.15 ? "warm" : "cold";
}

/** 1 for the answer down to 0 for the farthest, on a log scale so the top ranks spread out. */
export function heatOf(rank: number, n: number): number {
  return n <= 1 ? 1 : Math.max(0, 1 - Math.log(rank) / Math.log(n));
}

export const isSolved = (p: ClosenessPuzzle, s: ClosenessState): boolean => s.guesses[s.guesses.length - 1] === p.answer;

export function makeCloseness(data: () => PokemonDataset | undefined) {
  const dataset = (): PokemonDataset => {
    const d = data();
    if (!d) throw new Error("the pokémon data pack isn't loaded");
    return d;
  };

  const params = defineSchema({
    pool: poolField(data),
    similarity: {
      type: "enum", label: "alike means", default: "balanced",
      options: Object.entries(PROFILES).map(([value, p]) => ({ value, label: p.label })),
    },
    weights: {
      type: "string", label: "weights to change", default: "", placeholder: "e.g. type:6, color:0, family:5",
      description: "attribute:weight laid over the profile above; 0 leaves an attribute out. family counts being in the same evolution line",
      check: (v) => {
        const d = data();
        if (!d) return "the pokémon data pack isn't loaded";
        try {
          resolveWeights("balanced", v, d.attributes);
          return "";
        } catch (e) {
          return (e as Error).message;
        }
      },
    },
  });

  const cache = new Map<string, Scored>();
  /** The puzzle scored against the dataset (memoized: the last few puzzles stay). */
  function scored(p: ClosenessPuzzle): Scored {
    const d = dataset();
    const weightKey = Object.keys(p.weights).sort().map((k) => `${k}:${p.weights[k]}`).join(",");
    const mapKey = `${d.version}|${p.pool}|${weightKey}`;
    const key = `${mapKey}|${p.answer}`;
    let sc = cache.get(key);
    if (sc) return sc;
    const items = poolOf(d, p.pool, 2);
    const index = new Map(items.map((it, i) => [it.id, i]));
    const answer = index.get(p.answer);
    if (answer === undefined) throw new Error(`${p.answer} isn't among the pokémon this puzzle is played with`);
    const prior = [...cache.values()].find((c) => c.mapKey === mapKey);
    const space = prior?.space ?? new Space(items, d.attributes, p.weights);
    sc = { items, index, space, answer, close: closeness(space, answer), mapKey };
    if (cache.size >= 6) cache.delete(cache.keys().next().value!);
    cache.set(key, sc);
    return sc;
  }

  function generate(v: Values<typeof params>, rng: Rng): ClosenessPuzzle {
    const d = dataset();
    const items = poolOf(d, v.pool, 2);
    const weights = resolveWeights(v.similarity, v.weights, d.attributes);
    return { pool: v.pool, answer: rng.pick(items).id, weights };
  }

  function reduce(p: ClosenessPuzzle, s: ClosenessState, a: ClosenessAction): ClosenessState {
    if (isSolved(p, s)) return s;
    if (a.type === "reveal") return { ...s, guesses: [...s.guesses, p.answer], revealed: true };
    if (a.type !== "guess" || s.guesses.includes(a.id) || !scored(p).index.has(a.id)) return s;
    return { ...s, guesses: [...s.guesses, a.id], hinted: a.hint ? [...s.hinted, a.id] : s.hinted };
  }

  /** The best rank guessed so far (the pool size + 1 before any guess). */
  function best(p: ClosenessPuzzle, s: ClosenessState): number {
    const sc = scored(p);
    return s.guesses.reduce((b, id) => Math.min(b, sc.close[sc.index.get(id)!]!.rank), sc.items.length + 1);
  }

  /**
   * Contexto's hint: a pokémon halfway (by rank) between your best guess and the answer, not
   * guessed yet; the nearest such rank below halfway, else above.
   */
  function hint(p: ClosenessPuzzle, s: ClosenessState): Hint<ClosenessAction> | null {
    if (isSolved(p, s)) return null;
    const sc = scored(p);
    const b = best(p, s);
    const want = Math.max(1, Math.floor(b / 2));
    const guessed = new Set(s.guesses);
    const byRank = sc.close.map((c, i) => [c.rank, i] as const).filter(([, i]) => !guessed.has(sc.items[i]!.id)).sort((x, y) => x[0] - y[0]);
    if (!byRank.length) return null;
    const below = byRank.filter(([r]) => r <= want && r < b);
    const pick = below.length ? below[below.length - 1]! : byRank.find(([r]) => r >= want)!;
    const it = sc.items[pick[1]]!;
    return { message: `try ${it.name}`, actions: [{ type: "guess", id: it.id, hint: true }] };
  }

  function share(p: ClosenessPuzzle, s: ClosenessState): string {
    const sc = scored(p);
    const n = sc.items.length;
    const counts = { hot: 0, warm: 0, cold: 0 };
    for (const id of s.guesses) {
      const band = bandOf(sc.close[sc.index.get(id)!]!.rank, n);
      if (band !== "found") counts[band]++;
    }
    const total = s.guesses.length;
    const head = s.revealed ? `revealed after ${total - 1} ${total - 1 === 1 ? "guess" : "guesses"}` : isSolved(p, s) ? `found in ${total} ${total === 1 ? "guess" : "guesses"}` : `${total} guesses so far`;
    const hints = s.hinted.length ? `, ${s.hinted.length} ${s.hinted.length === 1 ? "hint" : "hints"}` : "";
    return `pokémon closeness: ${head}${hints}\n🟩 ${counts.hot} 🟨 ${counts.warm} 🟥 ${counts.cold}`;
  }

  const def: PuzzleDef<ClosenessPuzzle, ClosenessState, ClosenessAction, null, typeof params> = {
    id: "pokemon-closeness",
    name: "pokémon closeness",
    aliases: ["semantle", "contexto", "pokemon contexto", "hot and cold", "warmer colder"],
    tags: ["pokémon", "guessing", "words"],
    description: "find the hidden pokémon. every guess says how alike it is to the answer: its rank among all of them, and how warm it is. a map of every pokémon shows where your guesses sit, so you can head for the warm part.",
    generatorVersion: 1,
    datasets: ["pokemon"],
    params,
    presets: [
      { label: "every species", params: {} },
      { label: "gen 1", params: { pool: "form:default gen:1" } },
      { label: "gens 1–4", params: { pool: "form:default gen:1-4" } },
      { label: "by looks", params: { similarity: "looks" } },
      { label: "by battle stats", params: { similarity: "battle" } },
      { label: "every form (megas, regional…)", params: { pool: "" } },
    ],
    daily: { params: {} },
    // undoing a guess would take back a rank already seen and lower the count
    irreversible: true,
    generate,
    formats: [],
    init: () => ({ guesses: [], hinted: [] }),
    reduce,
    isSolved,
    solve: (p, s) => (isSolved(p, s) ? null : { moves: [{ type: "reveal" }] }),
    hint,
    rules: (p) => {
      const n = (() => { try { return scored(p).items.length; } catch { return 0; } })();
      return [
        `a pokémon is hidden among ${n || "the"} pokémon. guess any of them by name, as many times as you like.`,
        `each guess gets its rank: #1 is the answer, #2 the most alike, #${n || "last"} the least. its warmth says the same on a scale where the answer is 100° and a pokémon of middling likeness 0°.`,
        `alike means sharing what the weights count: ${Object.entries(p.weights).sort((a, b) => b[1] - a[1]).map(([k, w]) => `${k} ${w}`).join(", ")}.`,
        "the map puts alike pokémon near each other. warm guesses light up their part of the map; the map is only roughly right, the ranks are exact.",
        "a hint guesses a pokémon halfway (by rank) between your best guess and the answer.",
      ];
    },
    describe: (p) => {
      const prof = Object.entries(PROFILES).find(([, pr]) => JSON.stringify(Object.entries(pr.weights).sort()) === JSON.stringify(Object.entries(p.weights).sort()));
      return `${p.pool || "every form"}${prof ? (prof[0] === "balanced" ? "" : `, ${prof[0]}`) : ", own weights"}`;
    },
    describeAction: (p, a) => {
      if (a.type === "reveal") return "reveal the answer";
      const sc = scored(p);
      const i = sc.index.get(a.id);
      if (i === undefined) return `guess ${a.id}`;
      return `${a.hint ? "hint: " : ""}${sc.items[i]!.name}: #${sc.close[i]!.rank}`;
    },
    score: (_p, s) => (s.revealed ? null : { value: s.guesses.length, label: "guesses", better: "lower" }),
    shareText: share,
  };
  return { def, scored, best, params };
}

export type ClosenessDef = ReturnType<typeof makeCloseness>;
