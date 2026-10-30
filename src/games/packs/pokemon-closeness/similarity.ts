import type { DataAttribute } from "../../core/types";
import type { PokemonItem } from "../../lib/pokemon/types";

/**
 * How alike two pokémon are: a weighted Gower distance over the dataset's attributes, plus the
 * evolution family (an item field, not an attribute), in [0, 1].
 *
 * Per attribute, a distance in [0, 1]:
 * - number: difference of the two values' percentiles within the pool (midranks). Unit-free and
 *   untroubled by skew: weight runs 0.1 to 999.9 kg with half the pool under 28 kg, so a plain
 *   range would put nearly everything at the light end and call it "the same".
 * - ordinal: steps apart over the most steps there are.
 * - category, bool: 0 if equal, else 1.
 * - set: Jaccard distance, 1 − shared / either (fire vs fire/flying: 0.5).
 * - family: 0 in the same evolution family, else 1.
 * An attribute either item has nothing recorded for (habitat after gen 3) is left out of that pair,
 * and the weights of what is left are what the total is divided by (Gower's rule).
 */
export const FAMILY = "family";

export type Weights = Readonly<Record<string, number>>;

/**
 * Where the weights come from: what a player would call alike first, in this order. Same family and
 * type are what people mean by "close" (Charmander and Charizard, Charmander and Cyndaquil); then
 * the look (color, body shape, size) and the generation; then the battle numbers, which players
 * know roughly, as a profile spread over six stats plus the total; then the details few know by
 * heart (egg groups, catch rate, growth), each worth little alone but they cluster sensibly
 * (legendaries share catch rate 3, slow growth, no gender, undiscovered eggs).
 */
export const PROFILES: Readonly<Record<string, { label: string; weights: Weights }>> = {
  balanced: {
    label: "balanced",
    weights: {
      family: 3, type: 3, gen: 1.5, color: 1.5, shape: 1.5, class: 1.5, bst: 1.5,
      height: 1, weight: 1, egg: 1, form: 1, ability: 0.75, stage: 0.75,
      hp: 0.5, atk: 0.5, def: 0.5, spa: 0.5, spd: 0.5, spe: 0.5,
      final: 0.5, habitat: 0.5, capture: 0.5, growth: 0.5, gender: 0.5, eggcycles: 0.5, dex: 0.5,
      hidden: 0.25, happiness: 0.25,
    },
  },
  looks: {
    label: "looks (color, shape, size, type)",
    weights: { color: 3, shape: 3, type: 2, height: 2, weight: 1.5, family: 1, egg: 0.5 },
  },
  battle: {
    label: "battle (stats, type, abilities)",
    weights: { type: 3, bst: 2, hp: 1, atk: 1, def: 1, spa: 1, spd: 1, spe: 1, ability: 1.5, hidden: 0.5, final: 0.5, class: 0.5 },
  },
  lore: {
    label: "lore (family, generation, class, habitat, eggs)",
    weights: { family: 3, gen: 2, class: 2, habitat: 1.5, egg: 1.5, dex: 1, stage: 1, growth: 1, gender: 1, capture: 0.5 },
  },
};

/** Attributes the weights may name: every comparable attribute, and the family. */
export function weighable(attrs: readonly DataAttribute[]): string[] {
  return [FAMILY, ...attrs.filter((a) => a.kind !== "text").map((a) => a.id)];
}

/**
 * A profile's weights with `tweak` laid over them (`type:5, color:0`): any weighable id, any
 * non-negative number. Throws with what is wrong; at least one weight must stay above zero.
 */
export function resolveWeights(profile: string, tweak: string, attrs: readonly DataAttribute[]): Record<string, number> {
  const ok = new Set(weighable(attrs));
  const out: Record<string, number> = {};
  for (const [k, v] of Object.entries(PROFILES[profile]?.weights ?? PROFILES.balanced!.weights)) if (ok.has(k) && v > 0) out[k] = v;
  for (const part of tweak.split(",").map((p) => p.trim()).filter(Boolean)) {
    const m = /^([a-z0-9_-]+)\s*[:=]\s*(\d+(?:\.\d+)?)$/i.exec(part);
    if (!m) throw new Error(`"${part}": write attribute:weight, e.g. type:5 or color:0`);
    const id = m[1]!.toLowerCase();
    if (!ok.has(id)) throw new Error(`"${id}" isn't something to weigh; one of: ${[...ok].join(", ")}`);
    const w = Number(m[2]);
    if (w > 0) out[id] = w;
    else delete out[id];
  }
  if (!Object.keys(out).length) throw new Error("every weight is zero: nothing would be alike or different");
  return out;
}

type Feature =
  | { kind: "num"; w: number; v: Float64Array }
  | { kind: "cat"; w: number; v: Int32Array }
  | { kind: "mask"; w: number; v: Int32Array }
  | { kind: "list"; w: number; v: (Int32Array | null)[] };

const popcount = (x: number): number => {
  x -= (x >>> 1) & 0x55555555;
  x = (x & 0x33333333) + ((x >>> 2) & 0x33333333);
  return (((x + (x >>> 4)) & 0x0f0f0f0f) * 0x01010101) >>> 24;
};

/** Midrank percentiles in [0, 1] of the non-null values (NaN for null). */
function percentiles(vals: readonly (number | null)[]): Float64Array {
  const idx = vals.map((v, i) => [v, i] as const).filter((x): x is readonly [number, number] => x[0] !== null).sort((a, b) => a[0] - b[0]);
  const out = new Float64Array(vals.length).fill(NaN);
  const m = idx.length;
  for (let i = 0; i < m;) {
    let j = i;
    while (j + 1 < m && idx[j + 1]![0] === idx[i]![0]) j++;
    const p = m > 1 ? (i + j) / 2 / (m - 1) : 0;
    for (let k = i; k <= j; k++) out[idx[k]![1]] = p;
    i = j + 1;
  }
  return out;
}

/** The distance between any two items of a pool under some weights, set up once per (pool, weights). */
export class Space {
  readonly n: number;
  private readonly features: Feature[];
  private readonly total: number;

  constructor(readonly items: readonly PokemonItem[], attrs: readonly DataAttribute[], weights: Weights) {
    this.n = items.length;
    const fs: Feature[] = [];
    for (const [id, w] of Object.entries(weights)) {
      if (!(w > 0)) continue;
      if (id === FAMILY) {
        fs.push({ kind: "cat", w, v: Int32Array.from(items, (it) => it.family) });
        continue;
      }
      const a = attrs.find((x) => x.id === id);
      if (!a || a.kind === "text") continue;
      const raw = items.map((it) => it.values[id] ?? null);
      const codes = new Map((a.values ?? []).map((v, i) => [v.value, i]));
      switch (a.kind) {
        case "number":
          fs.push({ kind: "num", w, v: percentiles(raw.map((v) => (v === null ? null : Number(v)))) });
          break;
        case "ordinal": {
          const span = Math.max(1, (a.values?.length ?? 1) - 1);
          fs.push({ kind: "num", w, v: Float64Array.from(raw, (v) => (v === null || !codes.has(String(v)) ? NaN : codes.get(String(v))! / span)) });
          break;
        }
        case "category":
        case "bool": {
          const local = new Map<string, number>();
          fs.push({ kind: "cat", w, v: Int32Array.from(raw, (v) => (v === null ? -1 : local.get(String(v)) ?? (local.set(String(v), local.size), local.size - 1))) });
          break;
        }
        case "set": {
          const list = raw.map((v) => (v === null ? null : (Array.isArray(v) ? (v as string[]) : [String(v)]).map((x) => codes.get(x) ?? -1).filter((c) => c >= 0)));
          if ((a.values?.length ?? 0) <= 31) fs.push({ kind: "mask", w, v: Int32Array.from(list, (l) => (l === null ? -1 : l.reduce((m, c) => m | (1 << c), 0))) });
          else fs.push({ kind: "list", w, v: list.map((l) => (l === null ? null : Int32Array.from(new Set(l)).sort())) });
          break;
        }
      }
    }
    this.features = fs;
    this.total = fs.reduce((s, f) => s + f.w, 0);
  }

  /** Distance between items i and j, in [0, 1]. */
  dist(i: number, j: number): number {
    if (i === j) return 0;
    let sum = 0, wsum = 0;
    for (const f of this.features) {
      let d: number;
      switch (f.kind) {
        case "num": {
          const a = f.v[i]!, b = f.v[j]!;
          if (Number.isNaN(a) || Number.isNaN(b)) continue;
          d = Math.abs(a - b);
          break;
        }
        case "cat": {
          const a = f.v[i]!, b = f.v[j]!;
          if (a < 0 || b < 0) continue;
          d = a === b ? 0 : 1;
          break;
        }
        case "mask": {
          const a = f.v[i]!, b = f.v[j]!;
          if (a < 0 || b < 0) continue;
          const u = popcount(a | b);
          d = u ? 1 - popcount(a & b) / u : 0;
          break;
        }
        case "list": {
          const a = f.v[i], b = f.v[j];
          if (!a || !b) continue;
          let x = 0, y = 0, shared = 0;
          while (x < a.length && y < b.length) {
            if (a[x] === b[y]) { shared++; x++; y++; } else if (a[x]! < b[y]!) x++; else y++;
          }
          const u = a.length + b.length - shared;
          d = u ? 1 - shared / u : 0;
          break;
        }
      }
      sum += f.w * d;
      wsum += f.w;
    }
    // nothing comparable recorded for either: as unlike as anything
    return wsum > 0 ? sum / wsum : this.total > 0 ? 1 : 0;
  }

  /** Distances from item i to every item. */
  row(i: number): Float64Array {
    const out = new Float64Array(this.n);
    for (let j = 0; j < this.n; j++) out[j] = this.dist(i, j);
    return out;
  }
}

/** What a guess learns about the answer. */
export interface Closeness {
  /** 1 for the answer; else 1 + how many pokémon are closer to it than this one (at least 2). */
  rank: number;
  /** 100 for the answer, 0 for the pool's median distance from it, negative further out. */
  temp: number;
}

/** Every item's closeness to the answer at index `answer`. */
export function closeness(space: Space, answer: number): Closeness[] {
  const d = space.row(answer);
  const sorted = Float64Array.from(d).sort();
  const median = sorted[Math.floor(sorted.length / 2)] || 1;
  // rank by binary search on the sorted distances: how many are strictly closer
  const below = (x: number) => {
    let lo = 0, hi = sorted.length;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (sorted[mid]! < x) lo = mid + 1; else hi = mid;
    }
    return lo;
  };
  return Array.from(d, (x, j) => ({
    rank: j === answer ? 1 : Math.max(2, 1 + below(x)),
    temp: j === answer ? 100 : Math.round((100 * (median - x)) / median),
  }));
}
